import { useStore } from '@nanostores/react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionRoute } from '@/app/routes'
import { stubThreadEnvironment } from '@/components/assistant-ui/test-utils'
import {
  $quoteFeedback,
  addQuoteFeedback,
  quoteFeedbackKey,
  removeQuoteFeedback,
  updateQuoteFeedback
} from '@/store/quote-feedback'
import { $sessions } from '@/store/session'

import { ChatRuntimeBoundary } from '..'
import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from '../composer/scope'
import { useComposerSessionScope } from '../hooks/use-composer-session-scope'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '../session-view'

import { useQuoteFeedbackScope } from './context'
import { QuoteFeedbackPanel } from './panel'

stubThreadEnvironment()
const owner = { connectionId: 'connection-a', profile: 'desktop-alias', targetProfile: 'backend-target' }
const tip = { ...owner, sessionId: 'tip' }
const root = { ...owner, sessionId: 'root' }
const passage = { messageId: 'answer', rowId: 12, text: 'Lineage snapshot', start: 0, end: 16, prefix: '', suffix: '' }
const mutations = { onCancel: vi.fn(), onEdit: vi.fn(), onReload: vi.fn(), onThreadMessagesChange: vi.fn() }

const view = {
  ...PRIMARY_SESSION_VIEW,
  $storedId: atom<string | null>('tip'),
  $runtimeId: atom<string | null>('runtime')
}

function Observe() {
  const scope = useQuoteFeedbackScope()!

  return (
    <>
      <output data-testid="feedback-key">{scope.key}</output>
      <QuoteFeedbackPanel onAddToDraft={() => true} />
    </>
  )
}

function Harness({ pathname = sessionRoute('tip'), route = owner }) {
  const sessions = useStore($sessions)
  const selectedId = useStore(view.$storedId)

  const { feedbackSessionKey } = useComposerSessionScope({
    primary: true,
    pathname,
    selectedId,
    runtimeId: 'runtime',
    freshDraftKey: 'draft',
    sessions,
    onCancel: mutations.onCancel
  })

  return (
    <ComposerScopeProvider
      value={{
        ...MAIN_COMPOSER_SCOPE,
        connectionId: route.connectionId,
        profile: route.targetProfile,
        ownerRoute: route
      }}
    >
      <SessionViewProvider value={view}>
        <ChatRuntimeBoundary
          busy={false}
          feedbackSessionKey={feedbackSessionKey}
          suppressMessages={false}
          {...mutations}
        >
          <Observe />
        </ChatRuntimeBoundary>
      </SessionViewProvider>
    </ComposerScopeProvider>
  )
}

beforeEach(() => {
  $quoteFeedback.set({})
  $sessions.set([])
  view.$storedId.set('tip')
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  $quoteFeedback.set({})
  $sessions.set([])
})

describe('quote lineage in the mounted chat lifecycle', () => {
  it('moves tip feedback when metadata discovers the root, keeping notes and unused numbers owner-scoped', () => {
    const oldKey = quoteFeedbackKey(tip)
    const rootKey = quoteFeedbackKey(root)
    const removed = addQuoteFeedback(oldKey, { ...passage, messageId: 'removed', rowId: 11 })!
    const retained = addQuoteFeedback(oldKey, passage)!
    updateQuoteFeedback(oldKey, retained.id, 'Keep this note')
    removeQuoteFeedback(oldKey, removed.id)
    const before = $quoteFeedback.get()[oldKey]

    const foreign = [
      { ...tip, connectionId: 'connection-b' },
      { ...tip, profile: 'other-alias' },
      { ...tip, targetProfile: 'other-target' }
    ].map(scope => quoteFeedbackKey(scope))

    foreign.forEach(key => addQuoteFeedback(key, passage))
    render(<Harness />)
    expect(screen.getByTestId('feedback-key').textContent).toBe(oldKey)

    act(() => $sessions.set([{ id: 'tip', _lineage_root_id: 'root' }] as never))

    expect(screen.getByTestId('feedback-key').textContent).toBe(rootKey)
    expect($quoteFeedback.get()[rootKey]).toEqual(before)
    expect($quoteFeedback.get()[oldKey]).toBeUndefined()
    expect(foreign.map(key => $quoteFeedback.get()[key]?.items.length)).toEqual([1, 1, 1])
    expect(screen.getByRole('textbox', { name: 'Your feedback — Quote 2' })).toHaveProperty('value', 'Keep this note')
    expect(Object.values(mutations).every(callback => callback.mock.calls.length === 0)).toBe(true)
  })

  it('merges an existing root without duplicating ids or overwriting notes and keeps capture deduplication', () => {
    const oldKey = quoteFeedbackKey(tip)
    const rootKey = quoteFeedbackKey(root)
    const shared = addQuoteFeedback(oldKey, passage)!
    const extra = addQuoteFeedback(oldKey, { ...passage, messageId: 'extra', rowId: 13 })!
    updateQuoteFeedback(oldKey, extra.id, 'Tip note')
    $quoteFeedback.set({
      ...$quoteFeedback.get(),
      [rootKey]: { nextNumber: 7, items: [{ ...shared, number: 4, note: 'Root note' }] }
    })
    render(<Harness />)
    act(() => $sessions.set([{ id: 'tip', _lineage_root_id: 'root' }] as never))

    expect($quoteFeedback.get()[oldKey]).toBeUndefined()
    expect($quoteFeedback.get()[rootKey]).toEqual({
      nextNumber: 8,
      items: [
        { ...shared, number: 4, note: 'Root note' },
        { ...extra, number: 7, note: 'Tip note' }
      ]
    })
    expect(addQuoteFeedback(rootKey, { ...passage, messageId: 'rehydrated-id' })).toMatchObject({
      id: shared.id,
      note: 'Root note',
      number: 4
    })
  })

  it('does not move feedback across a route/store mismatch or ordinary conversation navigation', () => {
    const oldKey = quoteFeedbackKey(tip)
    addQuoteFeedback(oldKey, passage)
    const before = $quoteFeedback.get()
    const mounted = render(<Harness />)
    act(() => $sessions.set([{ id: 'other-tip', _lineage_root_id: 'other-root' }] as never))
    mounted.rerender(<Harness pathname={sessionRoute('other-tip')} />)
    expect($quoteFeedback.get()).toBe(before)
    act(() => view.$storedId.set('other-tip'))
    expect($quoteFeedback.get()).toBe(before)
  })

  it('does not migrate during a simultaneous owner change with colliding session ids', () => {
    const other = { ...owner, connectionId: 'connection-b' }
    const ownKey = quoteFeedbackKey(tip)
    const otherKey = quoteFeedbackKey({ ...other, sessionId: 'tip' })
    addQuoteFeedback(ownKey, passage)
    addQuoteFeedback(otherKey, passage)
    const before = $quoteFeedback.get()
    const mounted = render(<Harness />)

    act(() => {
      $sessions.set([{ id: 'tip', _lineage_root_id: 'root' }] as never)
      mounted.rerender(<Harness route={other} />)
    })

    expect($quoteFeedback.get()).toBe(before)
  })
})
