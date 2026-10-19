import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it } from 'vitest'

import { stubThreadEnvironment } from '@/components/assistant-ui/test-utils'
import type { ChatMessage } from '@/lib/chat-messages'
import { $activeGatewayProfile } from '@/store/profile'
import { $quoteFeedback, addQuoteFeedback, quoteFeedbackKey, updateQuoteFeedback } from '@/store/quote-feedback'
import { $connection, $sessions, _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import type { SessionOwnerRoute } from '@/store/session-request-router'

import { ChatRuntimeBoundary } from '..'
import { ComposerScopeProvider, MAIN_COMPOSER_SCOPE } from '../composer/scope'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '../session-view'

import { useQuoteFeedbackScope } from './context'
import { QuoteFeedbackPanel } from './panel'

stubThreadEnvironment()

const view = {
  ...PRIMARY_SESSION_VIEW,
  $messages: atom<ChatMessage[]>([]),
  $runtimeId: atom<string | null>('quote-runtime'),
  $storedId: atom<string | null>('quote-stored')
}

function ScopeProbe() {
  const scope = useQuoteFeedbackScope()

  return (
    <output data-testid="feedback-scope">{JSON.stringify(scope && { key: scope.key, enabled: scope.enabled })}</output>
  )
}

const remoteOwner = { connectionId: 'remote', profile: 'writer', targetProfile: 'backend-writer' }

interface HarnessProps {
  sessionKey: string
  suppressed?: boolean
  owner?: SessionOwnerRoute
}

function Harness({ sessionKey, suppressed = false, owner = remoteOwner }: HarnessProps) {
  return (
    <ComposerScopeProvider
      value={{
        ...MAIN_COMPOSER_SCOPE,
        connectionId: owner.connectionId,
        profile: owner.targetProfile ?? owner.profile
      }}
    >
      <SessionViewProvider value={view}>
        <ChatRuntimeBoundary
          busy={false}
          feedbackOwnerRoute={owner}
          feedbackSessionKey={sessionKey}
          onCancel={() => {}}
          onEdit={async () => {}}
          onReload={async () => {}}
          onThreadMessagesChange={() => {}}
          suppressMessages={suppressed}
        >
          <ScopeProbe />
          <QuoteFeedbackPanel onAddToDraft={() => true} />
        </ChatRuntimeBoundary>
      </SessionViewProvider>
    </ComposerScopeProvider>
  )
}

afterEach(() => {
  cleanup()
  _resetSessionOwnerHintsForTests({ storage: true })
  $connection.set(null)
  $activeGatewayProfile.set('default')
  $sessions.set([])
  $quoteFeedback.set({})
  view.$storedId.set('quote-stored')
})

it('binds feedback to the durable draft and connection-qualified owner, disabling a stale transcript during a route switch', () => {
  setSessionOwnerHint('quote-stored', { connectionId: 'remote', profile: 'writer', targetProfile: 'backend-writer' })
  const surface = render(<Harness sessionKey="quote-lineage" />)

  const expectedKey = (sessionId: string) =>
    quoteFeedbackKey({
      connectionId: 'remote',
      profile: 'writer',
      targetProfile: 'backend-writer',
      sessionId
    })

  expect(JSON.parse(screen.getByTestId('feedback-scope').textContent!)).toEqual({
    key: expectedKey('quote-lineage'),
    enabled: true
  })

  surface.rerender(<Harness sessionKey="draft:next" suppressed />)

  expect(JSON.parse(screen.getByTestId('feedback-scope').textContent!)).toEqual({
    key: expectedKey('draft:next'),
    enabled: false
  })
})

it('keeps a remote tile’s desktop owner when unrelated foreground connection and profile change', () => {
  setSessionOwnerHint('quote-stored', { connectionId: 'remote', profile: 'writer', targetProfile: 'backend-writer' })
  $connection.set({ connectionId: 'local', mode: 'local' } as never)
  $activeGatewayProfile.set('default')
  render(<Harness sessionKey="quote-lineage" />)

  const expected = {
    key: quoteFeedbackKey({
      connectionId: 'remote',
      profile: 'writer',
      targetProfile: 'backend-writer',
      sessionId: 'quote-lineage'
    }),
    enabled: true
  }

  expect(JSON.parse(screen.getByTestId('feedback-scope').textContent!)).toEqual(expected)
  act(() => {
    $connection.set({ connectionId: 'remote', mode: 'remote' } as never)
    $activeGatewayProfile.set('writer')
  })
  expect(JSON.parse(screen.getByTestId('feedback-scope').textContent!)).toEqual(expected)
  act(() => {
    $connection.set({ connectionId: 'other-remote', mode: 'remote' } as never)
    $activeGatewayProfile.set('other')
  })
  expect(JSON.parse(screen.getByTestId('feedback-scope').textContent!)).toEqual(expected)
})

it('adopts tip-keyed quotes and notes when delayed metadata proves a same-lineage root', () => {
  $sessions.set([])
  const owner = { connectionId: 'remote', profile: 'writer', targetProfile: 'backend-writer' }
  const tipKey = quoteFeedbackKey({ ...owner, sessionId: 'quote-stored' })
  const rootKey = quoteFeedbackKey({ ...owner, sessionId: 'quote-root' })

  const item = addQuoteFeedback(tipKey, {
    messageId: 'answer',
    text: 'Keep this snapshot.',
    start: 0,
    end: 19,
    prefix: '',
    suffix: ''
  })!

  updateQuoteFeedback(tipKey, item.id, 'Keep my unsent note.')
  const surface = render(<Harness sessionKey="quote-stored" />)
  expect(screen.getByRole('textbox', { name: 'Your feedback — Quote 1' })).toHaveProperty(
    'value',
    'Keep my unsent note.'
  )

  act(() => $sessions.set([{ id: 'quote-stored', _lineage_root_id: 'quote-root' } as never]))
  surface.rerender(<Harness sessionKey="quote-root" />)

  expect($quoteFeedback.get()[tipKey]).toBeUndefined()
  expect($quoteFeedback.get()[rootKey]?.items).toEqual([{ ...item, note: 'Keep my unsent note.' }])
  expect(screen.getByRole('textbox', { name: 'Your feedback — Quote 1' })).toHaveProperty(
    'value',
    'Keep my unsent note.'
  )
})

it('does not migrate quotes during a real conversation switch even while the old transcript is selected', () => {
  const owner = { connectionId: 'remote', profile: 'writer', targetProfile: 'backend-writer' }
  const key = quoteFeedbackKey({ ...owner, sessionId: 'quote-stored' })
  const item = addQuoteFeedback(key, { messageId: 'answer', text: 'A only', start: 0, end: 6, prefix: '', suffix: '' })!
  const surface = render(<Harness sessionKey="quote-stored" />)

  act(() => $sessions.set([{ id: 'other-tip', _lineage_root_id: 'other-root' } as never]))
  surface.rerender(<Harness sessionKey="other-root" suppressed />)
  expect($quoteFeedback.get()[key]?.items).toEqual([item])
  expect($quoteFeedback.get()[quoteFeedbackKey({ ...owner, sessionId: 'other-root' })]).toBeUndefined()
  expect(screen.queryByRole('textbox', { name: 'Your feedback — Quote 1' })).toBeNull()
})

it('never moves another owner’s tip feedback when the surface changes owner and lineage key together', () => {
  const otherOwner = { ...remoteOwner, connectionId: 'other-connection' }
  const sourceKey = quoteFeedbackKey({ ...remoteOwner, sessionId: 'quote-stored' })
  const destinationKey = quoteFeedbackKey({ ...otherOwner, sessionId: 'quote-root' })

  const source = addQuoteFeedback(sourceKey, {
    messageId: 'answer',
    text: 'A only',
    start: 0,
    end: 6,
    prefix: '',
    suffix: ''
  })!

  const destination = addQuoteFeedback(destinationKey, {
    messageId: 'answer',
    text: 'B only',
    start: 0,
    end: 6,
    prefix: '',
    suffix: ''
  })!

  const surface = render(<Harness sessionKey="quote-stored" />)
  act(() => $sessions.set([{ id: 'quote-stored', _lineage_root_id: 'quote-root' } as never]))
  surface.rerender(<Harness owner={otherOwner} sessionKey="quote-root" />)

  expect($quoteFeedback.get()[sourceKey]?.items).toEqual([source])
  expect($quoteFeedback.get()[destinationKey]?.items).toEqual([destination])
})

it('does not accept another connection’s same-named session row as lineage proof', () => {
  const sourceKey = quoteFeedbackKey({ ...remoteOwner, sessionId: 'quote-stored' })

  const source = addQuoteFeedback(sourceKey, {
    messageId: 'answer',
    text: 'A only',
    start: 0,
    end: 6,
    prefix: '',
    suffix: ''
  })!

  const surface = render(<Harness sessionKey="quote-stored" />)
  act(() =>
    $sessions.set([
      {
        id: 'quote-stored',
        _lineage_root_id: 'foreign-root',
        connection_id: 'other-connection',
        profile: 'writer'
      } as never
    ])
  )
  surface.rerender(<Harness sessionKey="foreign-root" />)

  expect($quoteFeedback.get()[sourceKey]?.items).toEqual([source])
  expect($quoteFeedback.get()[quoteFeedbackKey({ ...remoteOwner, sessionId: 'foreign-root' })]).toBeUndefined()
})
