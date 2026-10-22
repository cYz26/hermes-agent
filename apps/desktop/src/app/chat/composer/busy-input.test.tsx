import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $clarifyRequests } from '@/store/clarify'
import { clearSessionDraft, mainComposerScope, stashSessionDraft } from '@/store/composer'
import { clearQueuedPrompts, getQueuedPrompts } from '@/store/composer-queue'
import { $gatewayState } from '@/store/session'

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

function Harness({ onCancel, onSteer, onSubmit }: Pick<ChatBarProps, 'onCancel' | 'onSteer' | 'onSubmit'>) {
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
          <ChatBar
            busy
            disabled={false}
            gateway={null}
            onCancel={onCancel}
            onSteer={onSteer}
            onSubmit={onSubmit}
            queueSessionKey={SESSION}
            sessionId={SESSION}
            state={state}
          />
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

beforeEach(() => {
  $gatewayState.set('open')
  stashSessionDraft(SESSION, FOLLOW_UP, [])
})

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
  clearSessionDraft(SESSION)
  clearQueuedPrompts(SESSION)
  $clarifyRequests.set({})
  $gatewayState.set('closed')
})

describe('queue-first busy composer', () => {
  it.each(['/status', '/compress preserve context'])('labels the immediate command %s as Send, not Queue', async command => {
    stashSessionDraft(SESSION, command, [])
    const onCancel = vi.fn<ChatBarProps['onCancel']>()
    const onSteer = vi.fn<NonNullable<ChatBarProps['onSteer']>>(async () => true)
    const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => true)
    const { container } = render(<Harness onCancel={onCancel} onSteer={onSteer} onSubmit={onSubmit} />)
    const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
    await waitFor(() => expect(composerPlainText(editor)).toBe(command))
    const primary = container.querySelector<HTMLButtonElement>('button[type="submit"]')!

    expect(primary.getAttribute('aria-label')).toBe('Send')
    fireEvent.click(primary)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(command, { composerScope: SESSION }))
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps a normal-chat clarify in control instead of redirecting or clearing its answer', async () => {
    $clarifyRequests.set({
      [SESSION]: {
        requestId: 'clarify-queue-first',
        sessionId: SESSION,
        questions: [{ qid: 'environment', question: 'Which environment?', choices: null, multiSelect: false }]
      }
    })
    const onCancel = vi.fn<ChatBarProps['onCancel']>()
    const onSteer = vi.fn<NonNullable<ChatBarProps['onSteer']>>(async () => true)
    const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => true)
    const { container } = render(<Harness onCancel={onCancel} onSteer={onSteer} onSubmit={onSubmit} />)
    const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
    await waitFor(() => expect(composerPlainText(editor)).toBe(FOLLOW_UP))

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, shiftKey: true })

    expect(onSteer).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Steer the current run' })).toBeNull()
    expect(container.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Send')
    expect(composerPlainText(editor)).toBe(FOLLOW_UP)
    expect($clarifyRequests.get()[SESSION]?.requestId).toBe('clarify-queue-first')
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['steer button', 'steer shortcut'] as const)('redirects only when the user explicitly chooses the %s', async gesture => {
    const onCancel = vi.fn<ChatBarProps['onCancel']>()
    const onSteer = vi.fn<NonNullable<ChatBarProps['onSteer']>>(async () => true)
    const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => true)
    const { container } = render(<Harness onCancel={onCancel} onSteer={onSteer} onSubmit={onSubmit} />)
    const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
    await waitFor(() => expect(composerPlainText(editor)).toBe(FOLLOW_UP))

    if (gesture === 'steer button') {
      fireEvent.click(screen.getByRole('button', { name: 'Steer the current run' }))
    } else {
      fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, shiftKey: true })
    }

    await waitFor(() => expect(onSteer).toHaveBeenCalledExactlyOnceWith(FOLLOW_UP))
    expect(getQueuedPrompts(SESSION)).toEqual([])
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['Enter', 'send button'] as const)('queues a follow-up with %s without redirecting or stopping the current turn', async gesture => {
    const onCancel = vi.fn<ChatBarProps['onCancel']>()
    const onSteer = vi.fn<NonNullable<ChatBarProps['onSteer']>>(async () => true)
    const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => true)
    const { container } = render(<Harness onCancel={onCancel} onSteer={onSteer} onSubmit={onSubmit} />)
    const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
    await waitFor(() => expect(composerPlainText(editor)).toBe(FOLLOW_UP))

    if (gesture === 'Enter') {
      fireEvent.keyDown(editor, { key: 'Enter' })
    } else {
      fireEvent.click(container.querySelector<HTMLButtonElement>('button[type="submit"]')!)
    }

    await waitFor(() => expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual([FOLLOW_UP]))
    expect(composerPlainText(editor)).toBe('')
    // A second Enter after the draft clears must not silently promote a queued message to Steer.
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(getQueuedPrompts(SESSION).map(entry => entry.text)).toEqual([FOLLOW_UP])
    expect(onSteer).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
