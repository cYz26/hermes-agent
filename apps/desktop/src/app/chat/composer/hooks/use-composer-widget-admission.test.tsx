import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { type PropsWithChildren, useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CanonicalDesktopProtocol } from '@/api/canonical-protocol'
import { handleSessionInfoEvent } from '@/app/session/hooks/use-message-stream/gateway-event/session-info'
import type { GatewayEventContext } from '@/app/session/hooks/use-message-stream/gateway-event/types'
import { useSubmitPrompt } from '@/app/session/hooks/use-prompt-actions/submit'
import { clearSubmitInFlight } from '@/app/session/hooks/use-prompt-actions/utils'
import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { en } from '@/i18n/en'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $composerAttachments, type ComposerAttachment } from '@/store/composer'
import {
  $queuedPromptsBySession,
  enqueueQueuedPrompt,
  getQueuedPrompts,
  isSteerableEntry,
  simulateComposerQueueReloadForTests
} from '@/store/composer-queue'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, $sessions } from '@/store/session'
import { clearAllSessionStates } from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'

import type { QueueEditState } from '../composer-utils'
import { requestComposerSubmit } from '../focus'
import { QueuePanel } from '../queue-panel'
import { ComposerScopeProvider, ComposerSurfaceProvider, MAIN_COMPOSER_SCOPE } from '../scope'

import { useComposerQueue } from './use-composer-queue'
import { useComposerSubmit } from './use-composer-submit'

// No owner/model launch: only the transport reply is deferred. Admission recovery, the prepared
// retry journal, canonical wire normalization and pending projection all use production code.
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

const SESSION = 'widget-admission-race'
const SURFACE = 'widget-admission-surface'
const TEXT = 'Run widget follow-up. Ω'
const attachment: ComposerAttachment = { id: 'unsent-file', kind: 'file', label: 'draft.txt' }

beforeEach(() => {
  window.localStorage.clear()
  clearAllSessionStates()
  clearSubmitInFlight()
  $queuedPromptsBySession.set({})
  $composerAttachments.set([attachment])
  $sessions.set([makeSessionInfo({ id: SESSION, source: 'gui' })])
  $activeGatewayProfile.set('default')
  $connection.set({
    mode: 'local', connectionId: 'local', profile: 'default', baseUrl: 'http://127.0.0.1:1',
    wsUrl: 'ws://127.0.0.1:1/api/ws?native_dial=1', token: '', logs: [], isFullscreen: false,
    nativeOverlayWidth: 0, windowButtonPosition: null
  })
})

afterEach(() => {
  cleanup()
  clearAllSessionStates()
  clearSubmitInFlight()
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
  $composerAttachments.set([])
  $sessions.set([])
  $connection.set(null)
  vi.restoreAllMocks()
})

function mountWidget() {
  let reject!: (error: Error) => void
  const acknowledgement = new Promise<never>((_resolve, onReject) => { reject = onReject })

  const requestGateway = vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<unknown> => {
    if (method !== 'prompt.submit') { throw new Error(`Unexpected RPC: ${method}`) }

    return acknowledgement
  })

  const draftRef = { current: 'unsent draft' }
  const editor = window.document.createElement('div')
  editor.textContent = draftRef.current
  const clearDraft = vi.fn(() => { draftRef.current = ''; editor.textContent = '' })
  const loadIntoComposer = vi.fn()
  const stashAt = vi.fn()
  const onSteer = vi.fn(async () => true)
  const protocol = new CanonicalDesktopProtocol()
  let sequence = 0

  const wrapper = ({ children }: PropsWithChildren) => (
    <ComposerScopeProvider value={MAIN_COMPOSER_SCOPE}>
      <ComposerSurfaceProvider value={SURFACE}>
        <PaneVisibleContext.Provider value={true}>
          <div data-composer-surface-id={SURFACE} data-composer-target="main">{children}</div>
        </PaneVisibleContext.Provider>
      </ComposerSurfaceProvider>
    </ComposerScopeProvider>
  )

  const hook = renderHook(() => {
    const state = useRef(createClientSessionState())

    const updateSessionState: Parameters<typeof useSubmitPrompt>[0]['updateSessionState'] = (_sid, update) => {
      state.current = update(state.current)

      return state.current
    }

    const submit = useSubmitPrompt({
      activeSessionIdRef: useRef(SESSION), busyRef: useRef(true), copy: en.desktop,
      createBackendSessionForSend: async () => null,
      getRoutedStoredSessionId: () => SESSION, getRuntimeIdForStoredSession: () => SESSION,
      getRouteToken: () => `/${SESSION}`,
      requestGateway: requestGateway as Parameters<typeof useSubmitPrompt>[0]['requestGateway'],
      resumeStoredSession: async () => undefined,
      runtimeIdByStoredSessionIdRef: useRef(new Map([[SESSION, SESSION]])),
      selectedStoredSessionIdRef: useRef(SESSION),
      syncAttachmentsForSubmit: async (sessionId, attachments) => ({ sessionId, attachments }),
      updateSessionState
    })

    const queue = useComposerQueue({
      activeQueueSessionKey: SESSION, attachments: [attachment], busy: true, clearDraft, draftRef,
      focusInput: () => undefined, loadIntoComposer, onCancel: vi.fn(), onSteer, onSubmit: submit,
      queueEditRef: useRef<QueueEditState | null>(null), queueSessionKey: SESSION, sessionId: SESSION
    })

    useComposerSubmit({
      activeQueueSessionKey: SESSION, activeQueueSessionKeyRef: useRef(SESSION), attachments: [attachment],
      busy: true, clearDraft, disabled: false, draftScopeRef: useRef(SESSION), draftRef,
      drainNextQueued: queue.drainNextQueued, editorRef: useRef(editor), exitQueuedEdit: queue.exitQueuedEdit,
      focusInput: () => undefined, inputDisabled: false, loadIntoComposer, onCancel: vi.fn(), onSteer,
      onSteerHidden: undefined, onSubmit: submit, queueCurrentDraft: queue.queueCurrentDraft,
      queueEdit: queue.queueEdit, queuedPrompts: queue.queuedPrompts, sessionId: SESSION,
      setComposerText: vi.fn(), stashAt
    })

    return queue
  }, { wrapper })

  // The same wire fanout the owner emits, normalized and applied through the session.info handler.
  const fanout = (inputId: string, status: string | null = 'queued') => {
    const pending = [
      { admission_id: 'older', input_id: 'older-input', status: 'queued', text: 'Older owner turn' },
      ...(status ? [{ admission_id: 'accepted', input_id: inputId, status, text: TEXT, controls: ['steer', 'replace'] }] : []),
      { admission_id: 'later', input_id: 'later-input', status: 'queued', text: 'Later owner turn' }
    ]

    const event = {
      type: 'session.info', session_id: SESSION, seq: ++sequence, replay_epoch: 'owner-epoch', profile: 'default',
      payload: { stored_session_id: SESSION, pending, revision: 1 } as Record<string, unknown>
    }

    protocol.event(event)
    handleSessionInfoEvent({
      deps: {
        activeGatewayProfile: 'default', activeSessionIdRef: { current: null }, hydrateFromStoredSession: vi.fn(),
        lastCwdInfoSessionRef: { current: null }, queryClient: { invalidateQueries: vi.fn() }, refreshHermesConfig: vi.fn(),
        scheduleSessionsRefresh: vi.fn(), sessionInterrupted: () => false, sessionStateByRuntimeIdRef: { current: new Map() },
        updateSessionState: vi.fn(state => state), upsertToolCall: vi.fn()
      },
      event, explicitSid: SESSION, fromActiveSource: () => true, isActiveEvent: false,
      occurredAt: Date.now() / 1000, payload: event.payload, scheduleConfigRefresh: vi.fn(), sessionId: SESSION
    } as unknown as GatewayEventContext)
  }

  return { clearDraft, draftRef, editor, fanout, hook, loadIntoComposer, onSteer, protocol, reject, requestGateway, stashAt }
}

it.each([true, false])('keeps one owner admission when widget fanout precedes rejection=%s', async fanoutBeforeRejection => {
  const h = mountWidget()
  await act(async () => { expect(requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' })).toBe(true) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const inputId = h.requestGateway.mock.calls[0][1]?.submission_id as string
  expect(inputId).toEqual(expect.any(String))

  if (fanoutBeforeRejection) {
    act(() => h.fanout(inputId))
  }

  await act(async () => { h.reject(new Error('connection closed before acknowledgement')) })

  if (!fanoutBeforeRejection) {
    // Unknown is not permission to redirect a second copy: only retry this exact input identity.
    expect(getQueuedPrompts(SESSION).map(({ id, text }) => ({ id, text }))).toEqual([{ id: inputId, text: TEXT }])
    expect(getQueuedPrompts(SESSION).every(entry => !isSteerableEntry(entry))).toBe(true)
    await act(async () => { expect(await h.hook.result.current.steerQueuedNow(inputId)).toBe(false) })
    act(() => h.hook.result.current.beginQueuedEdit(getQueuedPrompts(SESSION)[0]!))
    expect(h.hook.result.current.queueEdit).toBeNull()
    act(() => h.fanout(inputId))
  }

  const authoritativeRows = () => getQueuedPrompts(SESSION).map(({ id, text, serverStatus }) => ({ id, text, serverStatus }))

  const expected = [
    { id: 'older', text: 'Older owner turn', serverStatus: 'queued' },
    { id: 'accepted', text: TEXT, serverStatus: 'queued' },
    { id: 'later', text: 'Later owner turn', serverStatus: 'queued' }
  ]

  expect(authoritativeRows()).toEqual(expected)
  act(() => { h.fanout(inputId); h.fanout(inputId) })
  expect(authoritativeRows()).toEqual(expected)
  expect(getQueuedPrompts(SESSION).every(entry => !isSteerableEntry(entry))).toBe(true)
  await act(async () => {
    expect(await h.hook.result.current.steerQueuedNow(inputId)).toBe(false)
    expect(await h.hook.result.current.steerQueuedNow('accepted')).toBe(false)
    expect(await h.hook.result.current.drainNextQueued()).toBe(false)
  })
  expect(h.onSteer).not.toHaveBeenCalled()
  expect(h.requestGateway).toHaveBeenCalledTimes(1)
  expect(h.draftRef.current).toBe('unsent draft')
  expect(h.editor.textContent).toBe('unsent draft')
  expect($composerAttachments.get()).toEqual([attachment])
  expect(h.clearDraft).not.toHaveBeenCalled()
  expect(h.loadIntoComposer).not.toHaveBeenCalled()
  expect(h.stashAt).not.toHaveBeenCalled()
})

it('retries an unobserved widget admission with its prepared identity and payload after reload', async () => {
  const h = mountWidget()
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const firstParams = h.requestGateway.mock.calls[0][1]!
  const inputId = firstParams.submission_id as string
  await act(async () => { h.reject(new Error('connection closed before acknowledgement')) })
  act(() => simulateComposerQueueReloadForTests())

  h.requestGateway.mockImplementationOnce(async (method, params) => {
    h.fanout(inputId)

    return h.protocol.result(method, params ?? {}, {
      admission_id: 'accepted', ref: { session_id: SESSION }, status: 'queued'
    })
  })
  await act(async () => { expect(await h.hook.result.current.drainNextQueued()).toBe(true) })
  expect(h.requestGateway).toHaveBeenCalledTimes(2)
  expect(h.requestGateway.mock.calls[1][1]).toEqual(firstParams)
  expect(getQueuedPrompts(SESSION).map(entry => entry.id)).toEqual(['older', 'accepted', 'later'])
  act(() => h.fanout(inputId))
  expect(getQueuedPrompts(SESSION).every(entry => !isSteerableEntry(entry))).toBe(true)
  expect(h.draftRef.current).toBe('unsent draft')
  expect($composerAttachments.get()).toEqual([attachment])
  expect(h.clearDraft).not.toHaveBeenCalled()
})

it('retains an exact non-steerable widget retry when journal storage becomes unavailable', async () => {
  const h = mountWidget()
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const firstParams = h.requestGateway.mock.calls[0][1]!
  const inputId = firstParams.submission_id as string

  const unavailable = () => { throw new DOMException('Storage unavailable', 'SecurityError') }
  const reads = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(unavailable)
  const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(unavailable)

  try {
    await act(async () => { h.reject(new Error('connection closed while storage is unavailable')) })
    expect(getQueuedPrompts(SESSION)).toHaveLength(1)
    const retry = getQueuedPrompts(SESSION)[0]!
    expect(retry).toMatchObject({ id: inputId, submissionId: inputId, text: TEXT, attachments: [] })
    expect(isSteerableEntry(retry)).toBe(false)
    await act(async () => { expect(await h.hook.result.current.steerQueuedNow(inputId)).toBe(false) })
    act(() => h.hook.result.current.beginQueuedEdit(retry))
    expect(h.hook.result.current.queueEdit).toBeNull()
    expect(h.onSteer).not.toHaveBeenCalled()
    expect(h.draftRef.current).toBe('unsent draft')
    expect($composerAttachments.get()).toEqual([attachment])
    expect(h.clearDraft).not.toHaveBeenCalled()
  } finally {
    reads.mockRestore()
    writes.mockRestore()
  }

  h.requestGateway.mockImplementationOnce(async (method, params) => {
    h.fanout(inputId)

    return h.protocol.result(method, params ?? {}, {
      admission_id: 'accepted', ref: { session_id: SESSION }, status: 'queued'
    })
  })
  await act(async () => { expect(await h.hook.result.current.drainNextQueued()).toBe(true) })
  expect(h.requestGateway).toHaveBeenCalledTimes(2)
  expect(h.requestGateway.mock.calls[1][1]).toEqual(firstParams)
  expect(getQueuedPrompts(SESSION).filter(entry => entry.text === TEXT)).toHaveLength(1)
})

it('preserves existing queued intent while recovering a widget with unavailable storage', async () => {
  const h = mountWidget()
  let older!: NonNullable<ReturnType<typeof enqueueQueuedPrompt>>
  let foreign!: NonNullable<ReturnType<typeof enqueueQueuedPrompt>>
  act(() => {
    older = enqueueQueuedPrompt(SESSION, { text: 'older local intent', attachments: [attachment] })!
    foreign = enqueueQueuedPrompt('other-session', { text: 'other queued intent', attachments: [] })!
  })
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const inputId = h.requestGateway.mock.calls[0][1]?.submission_id as string

  const unavailable = () => { throw new DOMException('Storage unavailable', 'SecurityError') }
  const reads = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(unavailable)
  const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(unavailable)

  try {
    await act(async () => { h.reject(new Error('reply lost')) })
    expect(getQueuedPrompts(SESSION).map(entry => entry.id)).toEqual([older.id, inputId])
    expect(getQueuedPrompts('other-session')).toEqual([foreign])
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'hermes.desktop.composerQueue.v1' })))
    expect(getQueuedPrompts(SESSION)[0]).toEqual(older)
    expect(getQueuedPrompts(SESSION)[1]).toMatchObject({ id: inputId, submissionId: inputId, text: TEXT })
    expect(getQueuedPrompts('other-session')).toEqual([foreign])
  } finally {
    reads.mockRestore()
    writes.mockRestore()
  }
})

it.each(['started', 'retired'])('does not recreate a widget input whose owner already reported it %s', async status => {
  const h = mountWidget()
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const inputId = h.requestGateway.mock.calls[0][1]?.submission_id as string
  act(() => {
    h.fanout(inputId, 'started')

    if (status === 'retired') { h.fanout(inputId, null) }
  })
  await act(async () => { h.reject(new Error('late rejection after start')) })
  act(() => h.fanout(inputId, status === 'started' ? 'started' : null))
  expect(getQueuedPrompts(SESSION).map(entry => entry.id)).toEqual(['older', 'later'])
  expect(h.requestGateway).toHaveBeenCalledTimes(1)
  expect(h.onSteer).not.toHaveBeenCalled()
})

it('offers an exact retry before confirmation and only owner-served editing and steering after fanout', async () => {
  const h = mountWidget()
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const inputId = h.requestGateway.mock.calls[0][1]?.submission_id as string
  await act(async () => { h.reject(new Error('reply lost')) })
  const onSendNow = vi.fn()

  const panel = () => (
    <QueuePanel
      busy={true} editingId={null} entries={getQueuedPrompts(SESSION)} onDelete={vi.fn()}
      onEdit={h.hook.result.current.beginQueuedEdit} onResume={vi.fn()} onSendNow={onSendNow}
      onSteerNow={h.hook.result.current.steerQueuedNow} parked={false}
    />
  )

  const view = render(panel())
  fireEvent.click(await screen.findByRole('button', { name: /queued/i }))
  expect(screen.queryByRole('button', { name: en.composer.queueEdit })).toBeNull()
  expect(screen.queryByRole('button', { name: en.composer.queueSteer })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.composer.queueSendNext }))
  expect(onSendNow).toHaveBeenCalledExactlyOnceWith(inputId)

  act(() => h.fanout(inputId))
  view.rerender(panel())
  expect(screen.getAllByRole('button', { name: en.composer.queueEdit })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: en.composer.queueSteer })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: en.composer.queueSendNext })).toBeNull()
})

it('keeps ordinary queue editing available while stepping past an unconfirmed widget retry', async () => {
  const h = mountWidget()
  let older!: NonNullable<ReturnType<typeof enqueueQueuedPrompt>>
  let later!: NonNullable<ReturnType<typeof enqueueQueuedPrompt>>
  act(() => { older = enqueueQueuedPrompt(SESSION, { text: 'older local draft', attachments: [] })! })
  await act(async () => { requestComposerSubmit(TEXT, { surfaceId: SURFACE, target: 'main' }) })
  await waitFor(() => expect(h.requestGateway).toHaveBeenCalledTimes(1))
  const inputId = h.requestGateway.mock.calls[0][1]?.submission_id as string
  await act(async () => { h.reject(new Error('reply lost')) })
  act(() => { later = enqueueQueuedPrompt(SESSION, { text: 'later local draft', attachments: [] })! })
  act(() => h.hook.result.current.beginQueuedEdit(older))
  h.draftRef.current = older.text
  act(() => { expect(h.hook.result.current.stepQueuedEdit(1)).toBe(true) })
  expect(h.hook.result.current.queueEdit?.entryId).toBe(later.id)
  expect(getQueuedPrompts(SESSION).find(entry => entry.id === inputId)).toMatchObject({ text: TEXT, submissionId: inputId })
})
