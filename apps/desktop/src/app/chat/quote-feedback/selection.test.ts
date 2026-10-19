import { afterEach, describe, expect, it } from 'vitest'

import { captureQuotedPassage } from './selection'

const roots: HTMLElement[] = []

function fixture() {
  const root = document.createElement('div')
  // Static test fixture only, never external markup.
  root.innerHTML =
    '<div data-role="assistant" data-message-id="answer-1"><div data-slot="aui_assistant-message-content"><p>先<strong>验证核心体验</strong>，再考虑商业化。</p></div></div>'
  document.body.append(root)
  roots.push(root)

  return root
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  roots.splice(0).forEach(root => root.remove())
})

describe('chat quote capture', () => {
  it('captures a plain-text snapshot and rendered offsets from a passage, not Markdown or a live Range', () => {
    const root = fixture()
    const node = root.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()!
    selection.addRange(range)

    const captured = captureQuotedPassage(root, selection)
    selection.removeAllRanges()
    node.textContent = '后来被修改'

    expect(captured).toMatchObject({
      messageId: 'answer-1',
      text: '验证核心体验',
      start: 1,
      end: 7,
      prefix: '先',
      suffix: '，再考虑商业化。'
    })
  })

  it('rejects selections that cross non-prose controls even when both endpoints are prose', () => {
    const root = fixture()
    const content = root.querySelector('[data-slot="aui_assistant-message-content"]')!
    const control = document.createElement('textarea')
    const last = document.createElement('p')
    last.textContent = '最后一段。'
    content.append(control, last)
    const range = document.createRange()
    range.setStart(content.querySelector('p')!.firstChild!, 0)
    range.setEnd(last.firstChild!, 5)
    window.getSelection()!.addRange(range)

    expect(captureQuotedPassage(root, window.getSelection())).toBeNull()
  })

  it('rejects another pane’s selection and a reply that is still streaming', () => {
    const root = fixture()
    const other = fixture()
    const range = document.createRange()
    range.selectNodeContents(other.querySelector('strong')!)
    window.getSelection()!.addRange(range)
    expect(captureQuotedPassage(root, window.getSelection())).toBeNull()

    const marker = document.createElement('span')
    marker.dataset.messageStreaming = 'true'
    other.querySelector('[data-role="assistant"]')!.append(marker)
    expect(captureQuotedPassage(other, window.getSelection())).toBeNull()
  })
})
