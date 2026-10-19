import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { en } from '@/i18n/en'
import { $busyInputConfig, busyInputOwnerKey } from '@/store/busy-input-mode'
import { $clarifyRequests } from '@/store/clarify'
import { clearSessionDraft, type ComposerAttachment, mainComposerScope, stashSessionDraft } from '@/store/composer'
import { $parkedQueueSessions, clearQueuedPrompts, enqueueQueuedPrompt, getQueuedPrompts } from '@/store/composer-queue'
import { $connection, $gatewayState } from '@/store/session'

import { composerPlainText, RICH_INPUT_SLOT } from './rich-editor'
import type { ChatBarProps, ChatBarState } from './types'

import { ChatBar } from './index'

const SESSION = 'queue-first-composer-test'
const FOLLOW_UP = 'Run the tests after the current task.'

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: false, label: '' },
  voice: { enabled: false, active: false }
}

function Harness(props: Pick<ChatBarProps, 'onCancel' | 'onSteer' | 'onSubmit'>) {
  const runtime = useExternalStoreRuntime({
    convertMessage: (message: ThreadMessageLike) => message,
    messages: [] as ThreadMessageLike[],
    isRunning: true,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <ChatBar busy disabled={false} gateway={null} queueSessionKey={SESSION} sessionId={SESSION} state={state} {...props} />
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

async function renderBusyComposer(text = FOLLOW_UP, attachments: ComposerAttachment[] = []) {
  stashSessionDraft(SESSION, text, attachments)
  const onCancel = vi.fn<ChatBarProps['onCancel']>()
  const onSteer = vi.fn<NonNullable<ChatBarProps['onSteer']>>(async () => true)
  const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => true)
  const { container } = render(<Harness onCancel={onCancel} onSteer={onSteer} onSubmit={onSubmit} />)
  const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
  await waitFor(() => expect(composerPlainText(editor)).toBe(text))

  return { container, editor, onCancel, onSteer, onSubmit }
}

beforeEach(() => {
  $connection.set(null)
  $gatewayState.set('open')
  $busyInputConfig.set({ owner: busyInputOwnerKey(null, 'default'), connection: null, mode: 'interrupt' })
  stashSessionDraft(SESSION, FOLLOW_UP, [])
})

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
  clearSessionDraft(SESSION)
  clearQueuedPrompts(SESSION)
  $clarifyRequests.set({})
  $busyInputConfig.set(null)
  $connection.set(null)
  $gatewayState.set('closed')
})

describe('queue-first busy composer', () => {
  it.each(['Cmd+Enter', 'Ctrl+Enter'] as const)('keeps %s as a Queue alias', async gesture => {
    const { editor, onSteer, onCancel } = await renderBusyComposer()
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: gesture.startsWith('Cmd'), ctrlKey: gesture.startsWith('Ctrl') })

    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual([FOLLOW_UP])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('leaves Shift+Enter to native newline editing instead of sending', async () => {
    const { editor, onSubmit, onSteer, onCancel } = await renderBusyComposer()
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(composerPlainText(editor)).toBe(FOLLOW_UP)
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it.each(['Stop', 'Esc'] as const)('parks the FIFO before %s cancels the active turn', async gesture => {
    enqueueQueuedPrompt(SESSION, { text: 'first queued task', attachments: [] })
    enqueueQueuedPrompt(SESSION, { text: 'second queued task', attachments: [] })
    const { editor, onCancel, onSteer } = await renderBusyComposer('')
    onCancel.mockImplementation(() => { expect($parkedQueueSessions.get()[SESSION]).toBe(true) })

    if (gesture === 'Stop') {
      fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    } else {
      fireEvent.keyDown(editor, { key: 'Escape' })
    }

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSteer).not.toHaveBeenCalled()
    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual(['first queued task', 'second queued task'])
  })

  it.each(['legacy', 'canonical'] as const)('queues attachments through the %s authority without steering', async authority => {
    if (authority === 'canonical') {
      $connection.set({ mode: 'local', wsUrl: 'ws://localhost/api/ws?native_dial=unminted' } as never)
    }

    const attachment: ComposerAttachment = { id: 'queue-file', kind: 'file', label: 'notes.txt' }
    const { editor, onSubmit, onSteer, onCancel } = await renderBusyComposer(FOLLOW_UP, [attachment])

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(composerPlainText(editor)).toBe(FOLLOW_UP)
    expect(screen.queryByRole('button', { name: 'Steer the current run' })).toBeNull()
    fireEvent.keyDown(editor, { key: 'Enter' })

    if (authority === 'canonical') {
      await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(FOLLOW_UP, {
        attachments: [attachment], fromQueue: true, sessionId: SESSION, storedSessionId: SESSION
      }))
      expect(getQueuedPrompts(SESSION)).toEqual([])
    } else {
      expect(getQueuedPrompts(SESSION)).toEqual([expect.objectContaining({ text: FOLLOW_UP, attachments: [attachment] })])
      expect(onSubmit).not.toHaveBeenCalled()
    }

    await waitFor(() => expect(composerPlainText(editor)).toBe(''))
    expect(mainComposerScope.$attachments.get()).toEqual([])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('saves a queue edit without offering draft Steer or adding a second queued turn', async () => {
    enqueueQueuedPrompt(SESSION, { text: 'edit this queued task', attachments: [] })
    const { editor, onSteer, onCancel } = await renderBusyComposer('')
    fireEvent.keyDown(editor, { key: 'ArrowUp' })
    await waitFor(() => expect(composerPlainText(editor)).toBe('edit this queued task'))

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(screen.queryByRole('button', { name: 'Steer the current run' })).toBeNull()
    editor.textContent = 'the updated queued task'
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual(['the updated queued task'])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it.each(['/status', '/compress preserve context'])('labels the inline command %s Send and preserves submit identity', async command => {
    const { container, onCancel, onSteer, onSubmit } = await renderBusyComposer(command)
    const primary = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
    await waitFor(() => expect(primary.getAttribute('aria-label')).toBe('Send'))
    fireEvent.click(primary)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(command, {
      composerScope: SESSION, submission_id: expect.any(String)
    }))
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('lets an ordinary clarify own its answer and blocks explicit draft Steer', async () => {
    $clarifyRequests.set({
      [SESSION]: {
        requestId: 'clarify-queue-first', sessionId: SESSION,
        questions: [{ qid: 'where', question: 'Which environment?', choices: null, multiSelect: false }]
      }
    })
    const { container, editor, onCancel, onSteer, onSubmit } = await renderBusyComposer()
    await waitFor(() => expect(container.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Send'))

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, shiftKey: true })

    expect(screen.queryByRole('button', { name: 'Steer the current run' })).toBeNull()
    expect(composerPlainText(editor)).toBe(FOLLOW_UP)
    expect($clarifyRequests.get()[SESSION]?.requestId).toBe('clarify-queue-first')
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSteer).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('blocks queue-row Steer while an ordinary clarify owns the turn', async () => {
    $clarifyRequests.set({
      [SESSION]: {
        requestId: 'clarify-queue-row', sessionId: SESSION,
        questions: [{ qid: 'where', question: 'Which environment?', choices: null, multiSelect: false }]
      }
    })
    enqueueQueuedPrompt(SESSION, { text: 'An earlier queued task.', attachments: [] })
    await renderBusyComposer()
    fireEvent.click(await screen.findByRole('button', { name: /queued/i }))

    expect(screen.queryByRole('button', { name: en.composer.queueSteer })).toBeNull()
    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual(['An earlier queued task.'])
  })

  it.each(['steer button', 'Cmd+Shift+Enter', 'Ctrl+Shift+Enter'] as const)(
    'redirects the current run only through the explicit %s gesture',
    async gesture => {
      const { editor, onCancel, onSteer, onSubmit } = await renderBusyComposer()
      // A discrete Steer gesture must read the live DOM, not a frame-old draft.
      editor.textContent = 'Use the live correction.'

      if (gesture === 'steer button') {
        fireEvent.click(await screen.findByRole('button', { name: 'Steer the current run' }))
      } else {
        fireEvent.keyDown(editor, { key: 'Enter', metaKey: gesture.startsWith('Cmd'), ctrlKey: gesture.startsWith('Ctrl'), shiftKey: true })
      }

      await waitFor(() => expect(onSteer).toHaveBeenCalledExactlyOnceWith('Use the live correction.', 'interrupt'))
      expect(getQueuedPrompts(SESSION)).toEqual([])
      expect(onCancel).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
    }
  )

  it('never promotes a queued message on repeated empty busy Enter', async () => {
    const { editor, onCancel, onSteer, onSubmit } = await renderBusyComposer()
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(composerPlainText(editor)).toBe(''))

    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual([FOLLOW_UP])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['Enter', 'send button'] as const)('queues a follow-up with %s without redirecting or stopping the current turn', async gesture => {
    const { container, editor, onCancel, onSteer, onSubmit } = await renderBusyComposer()

    if (gesture === 'Enter') {
      fireEvent.keyDown(editor, { key: 'Enter' })
    } else {
      fireEvent.click(container.querySelector<HTMLButtonElement>('button[type="submit"]')!)
    }

    await waitFor(() => expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual([FOLLOW_UP]))
    expect(composerPlainText(editor)).toBe('')
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
