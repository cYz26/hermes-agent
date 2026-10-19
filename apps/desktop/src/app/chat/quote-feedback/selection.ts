import type { QuotedPassage } from '@/store/quote-feedback'

const CONTENT = '[data-slot="aui_assistant-message-content"]'

const EXCLUDED =
  'button, input, textarea, [contenteditable="true"], [aria-hidden="true"], [data-conversation-scaffold], [data-slot="tool-group"]'

const elementAt = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)

/** Resolve one continuous, owned message selection. Cross-message/surface picks fail closed. */
export function captureQuotedPassage(root: HTMLElement, selection: Selection | null): QuotedPassage | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return null
  }

  const range = selection.getRangeAt(0)
  const startElement = elementAt(range.startContainer)
  const endElement = elementAt(range.endContainer)
  const content = startElement?.closest<HTMLElement>(CONTENT)
  const message = content?.closest<HTMLElement>('[data-role="assistant"][data-message-id]')

  if (
    !content ||
    !message?.dataset.messageId ||
    !root.contains(content) ||
    !content.contains(range.endContainer) ||
    startElement?.closest(EXCLUDED) ||
    endElement?.closest(EXCLUDED) ||
    [...content.querySelectorAll(EXCLUDED)].some(node => range.intersectsNode(node)) ||
    message.querySelector('[data-message-streaming="true"]')
  ) {
    return null
  }

  const text = selection.toString()

  if (!text.trim()) {
    return null
  }

  const prefixRange = document.createRange()
  prefixRange.selectNodeContents(content)
  prefixRange.setEnd(range.startContainer, range.startOffset)
  const start = prefixRange.toString().length
  const end = start + range.toString().length
  const rendered = content.textContent ?? ''

  return {
    messageId: message.dataset.messageId,
    text,
    start,
    end,
    prefix: rendered.slice(Math.max(0, start - 40), start),
    suffix: rendered.slice(end, end + 40)
  }
}
