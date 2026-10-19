import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $quoteFeedback, type QuoteFeedbackScope } from '@/store/quote-feedback'

import { QuoteFeedbackPanel } from './panel'
import { QuoteFeedbackProvider } from './scope'

const scope: QuoteFeedbackScope = {
  connectionId: 'local',
  profile: 'default',
  targetProfile: 'default',
  sessionId: 'session-a'
}

function select(node: Node) {
  const range = window.document.createRange()
  range.selectNodeContents(node)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  fireEvent.pointerUp(node.parentElement!)
}

beforeEach(() => {
  $quoteFeedback.set({})
  // jsdom has no layout; selection geometry is exercised in the Electron spec.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 120, top: 60, bottom: 80, width: 180, height: 20 })
  })
})
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

describe('chat quote feedback flow', () => {
  it('collects two passages and their notes before handing one reviewable block to the draft', async () => {
    const addToDraft = vi.fn<(text: string) => boolean>(() => true)
    render(
      <QuoteFeedbackProvider scope={scope}>
        <div data-message-id="answer-1" data-role="assistant">
          <div data-slot="aui_assistant-message-content">
            <p>体验优先。</p>
            <p>保留跨类型选材。</p>
          </div>
        </div>
        <QuoteFeedbackPanel onAddToDraft={addToDraft} />
      </QuoteFeedbackProvider>
    )

    select(screen.getByText('体验优先。').firstChild!)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to chat' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your feedback — Quote 1' }), {
      target: { value: '先验证这一点。' }
    })
    select(screen.getByText('保留跨类型选材。').firstChild!)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to chat' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your feedback — Quote 2' }), {
      target: { value: '不要收窄范围。' }
    })

    expect(addToDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add all to draft' }))
    expect(addToDraft).toHaveBeenCalledTimes(1)
    const payload = addToDraft.mock.calls[0]![0]
    expect(payload).toContain('体验优先。')
    expect(payload).toContain('先验证这一点。')
    expect(payload).toContain('保留跨类型选材。')
    expect(payload).toContain('不要收窄范围。')
    expect(screen.queryByRole('button', { name: 'Add all to draft' })).toBeNull()
  })

  it('keeps the original snapshot and note when adding to a draft fails', async () => {
    const { addQuoteFeedback, quoteFeedbackKey, updateQuoteFeedback } = await import('@/store/quote-feedback')
    const key = quoteFeedbackKey(scope)

    const item = addQuoteFeedback(key, {
      messageId: 'answer',
      text: 'snapshot',
      start: 0,
      end: 8,
      prefix: '',
      suffix: ''
    })!

    updateQuoteFeedback(key, item.id, 'My note.')
    render(
      <QuoteFeedbackProvider scope={scope}>
        <QuoteFeedbackPanel onAddToDraft={() => false} />
      </QuoteFeedbackProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add all to draft' }))

    expect(screen.getByRole('alert').textContent).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Your feedback — Quote 1' })).toHaveProperty('value', 'My note.')
    expect($quoteFeedback.get()[key]!.items[0]!.text).toBe('snapshot')
  })

  it('shows only its own conversation’s feedback across owner/session switches and remounts', async () => {
    const { addQuoteFeedback, quoteFeedbackKey } = await import('@/store/quote-feedback')
    const key = quoteFeedbackKey(scope)
    addQuoteFeedback(key, {
      messageId: 'answer',
      text: 'Session A snapshot',
      start: 0,
      end: 18,
      prefix: '',
      suffix: ''
    })

    const panel = (owner: typeof scope) => (
      <QuoteFeedbackProvider scope={owner}>
        <QuoteFeedbackPanel onAddToDraft={() => true} />
      </QuoteFeedbackProvider>
    )

    const view = render(panel(scope))
    expect(screen.getByText('Session A snapshot', { selector: 'summary' })).toBeTruthy()
    view.rerender(panel({ ...scope, sessionId: 'session-b' }))
    expect(screen.queryByText('Session A snapshot')).toBeNull()
    view.rerender(panel({ ...scope, connectionId: 'remote' }))
    expect(screen.queryByText('Session A snapshot')).toBeNull()
    view.unmount()
    render(panel(scope))
    expect(screen.getByText('Session A snapshot', { selector: 'summary' })).toBeTruthy()
  })
})
