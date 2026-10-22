import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubThreadEnvironment } from '@/components/assistant-ui/test-utils'
import { $activeGatewayProfile } from '@/store/profile'
import { $quoteFeedback, addQuoteFeedback, quoteFeedbackKey } from '@/store/quote-feedback'
import { $connection, _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import { $sessionTiles, patchSessionTile } from '@/store/session-states'

import type * as ChatModule from '..'
import { useComposerScope } from '../composer/scope'
import { SessionTilePane } from '../session-tile'

import { useQuoteFeedbackScope } from './context'
import { QuoteFeedbackPanel } from './panel'

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ gateway: null, requestGateway: vi.fn() })
}))
vi.mock('@/app/session/hooks/use-model-controls', () => ({ useModelControls: () => ({ selectModel: vi.fn() }) }))
vi.mock('../session-tile-actions', () => ({ useSessionTileActions: () => ({}) }))
vi.mock('../hooks/use-composer-actions', () => ({ useComposerActions: () => ({}) }))
vi.mock('..', async importOriginal => {
  const actual = await importOriginal<typeof ChatModule>()

  return {
    ...actual,
    // Keep the real tile scope -> runtime boundary -> quote store path; omit the
    // unrelated thread/composer UI, which would need a connected gateway.
    ChatView: (props: ComponentProps<typeof actual.ChatView>) => (
      <actual.ChatRuntimeBoundary {...props} busy={false} suppressMessages={false}>
        <QuoteProbe />
      </actual.ChatRuntimeBoundary>
    )
  }
})

function QuoteProbe() {
  const scope = useQuoteFeedbackScope()!
  const composer = useComposerScope()

  return (
    <>
      <output data-testid="quote-key">{scope.key}</output>
      <output data-testid="voice-profile">{composer.profile}</output>
      <button
        onClick={() =>
          addQuoteFeedback(scope.key, {
            messageId: 'answer',
            text: 'Tile snapshot',
            start: 0,
            end: 13,
            prefix: '',
            suffix: ''
          })
        }
      >
        Capture quote
      </button>
      <QuoteFeedbackPanel onAddToDraft={() => true} />
    </>
  )
}

stubThreadEnvironment()
const owner = { connectionId: 'tile-connection', profile: 'desktop-alias', targetProfile: 'backend-target' }
const key = quoteFeedbackKey({ ...owner, sessionId: 'stored-tile' })

beforeEach(() => {
  $quoteFeedback.set({})
  _resetSessionOwnerHintsForTests()
  setSessionOwnerHint('stored-tile', owner)
  $connection.set({ connectionId: 'other-connection', mode: 'remote' } as never)
  $activeGatewayProfile.set('unrelated')
  $sessionTiles.set([
    { storedSessionId: 'stored-tile', runtimeId: 'runtime-tile', ownerRoute: owner, workspaceMode: 'bots' }
  ])
  patchSessionTile('stored-tile', {})
})
afterEach(() => {
  cleanup()
  $sessionTiles.set([])
  $quoteFeedback.set({})
  _resetSessionOwnerHintsForTests()
})

describe('tile quote ownership through the runtime boundary', () => {
  it('retains its captured alias/target and notes when unrelated foreground routing changes', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionTilePane storedSessionId="stored-tile" />
      </QueryClientProvider>
    )
    const before = screen.getByTestId('quote-key').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Capture quote' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your feedback — Quote 1' }), {
      target: { value: 'Keep this note' }
    })

    act(() => {
      $connection.set({ connectionId: owner.connectionId, mode: 'remote' } as never)
      $activeGatewayProfile.set(owner.profile)
      patchSessionTile('stored-tile', { runtimeId: 'runtime-tile' })
    })

    expect.soft(before).toBe(key)
    expect.soft(screen.getByTestId('quote-key').textContent).toBe(key)
    expect
      .soft((screen.queryByRole('textbox', { name: 'Your feedback — Quote 1' }) as HTMLTextAreaElement | null)?.value)
      .toBe('Keep this note')
    expect.soft(Object.keys($quoteFeedback.get())).toEqual([key])
    // Voice/backend routing must still use the backend target, not the alias.
    expect(screen.getByTestId('voice-profile').textContent).toBe(owner.targetProfile)
  })
})
