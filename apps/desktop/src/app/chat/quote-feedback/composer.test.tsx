import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatBar } from '@/app/chat/composer'
import { composerPlainText, RICH_INPUT_SLOT } from '@/app/chat/composer/rich-editor'
import type { ChatBarProps, ChatBarState } from '@/app/chat/composer/types'
import { I18nProvider } from '@/i18n'
import { clearSessionDraft, mainComposerScope, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { $quoteFeedback, addQuoteFeedback, quoteFeedbackKey } from '@/store/quote-feedback'
import { $gatewayState } from '@/store/session'

import { QuoteFeedbackProvider } from './scope'

const scope = { connectionId: 'local', profile: 'default', targetProfile: 'default', sessionId: 'quote-composer-test' }

const state: ChatBarState = {
  model: { canSwitch: false, model: '', provider: '' },
  tools: { enabled: false, label: '' },
  voice: { enabled: false, active: false }
}

function Harness({ onSubmit }: Pick<ChatBarProps, 'onSubmit'>) {
  const runtime = useExternalStoreRuntime({
    convertMessage: (message: ThreadMessageLike) => message,
    messages: [] as ThreadMessageLike[],
    isRunning: false,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <QuoteFeedbackProvider scope={scope}>
            <ChatBar
              busy={false}
              disabled={false}
              gateway={null}
              onCancel={() => {}}
              onSubmit={onSubmit}
              queueSessionKey={scope.sessionId}
              sessionId={scope.sessionId}
              state={state}
            />
          </QuoteFeedbackProvider>
        </I18nProvider>
      </MemoryRouter>
    </AssistantRuntimeProvider>
  )
}

beforeEach(() => {
  $gatewayState.set('open')
  $quoteFeedback.set({})
  stashSessionDraft(scope.sessionId, 'Existing draft stays here.', [])
  addQuoteFeedback(quoteFeedbackKey(scope), {
    messageId: 'answer-1',
    text: '先验证核心体验。',
    start: 0,
    end: 8,
    prefix: '',
    suffix: ''
  })
})

afterEach(() => {
  cleanup()
  mainComposerScope.clear()
  clearSessionDraft(scope.sessionId)
  $quoteFeedback.set({})
  $gatewayState.set('closed')
})

describe('quote feedback in the real composer', () => {
  it('preserves the live draft, persists the handoff immediately, and restores it when submit is rejected', async () => {
    const onSubmit = vi.fn<ChatBarProps['onSubmit']>(async () => false)
    const { container } = render(<Harness onSubmit={onSubmit} />)
    const editor = container.querySelector<HTMLElement>(`[data-slot="${RICH_INPUT_SLOT}"]`)!
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your feedback — Quote 1' }), {
      target: { value: '先测玩法。' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add all to draft' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(composerPlainText(editor)).toContain('Existing draft stays here.')
    expect(composerPlainText(editor)).toContain('先验证核心体验。')
    expect(takeSessionDraft(scope.sessionId).text).toContain('先测玩法。')
    expect($quoteFeedback.get()[quoteFeedbackKey(scope)]?.items ?? []).toEqual([])

    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(composerPlainText(editor)).toContain('先测玩法。'))
    expect(onSubmit.mock.calls[0]![0]).toContain('Existing draft stays here.')
    expect(onSubmit.mock.calls[0]![0]).toContain('先验证核心体验。')
  })
})
