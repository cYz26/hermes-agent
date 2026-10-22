import { TIMELINE_REVEAL_EVENT, type TimelineRevealRequest } from '@/components/assistant-ui/thread/timeline-data'
import type { QuotedPassage } from '@/store/quote-feedback'

/** Reuse bounded transcript paging; never search or navigate a neighboring pane. */
export async function showQuoteSource(root: HTMLElement, passage: QuotedPassage, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return false
  }

  const find = (id: string) => [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === id)
  let source = find(passage.messageId)

  if (!source) {
    const viewport = root.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')

    if (!viewport) {
      return false
    }

    const revealed = await new Promise<string | false>(resolve => {
      let settled = false

      const finish = (id: string | false) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', cancel)
        resolve(id)
      }

      const cancel = () => finish(false)
      const timeout = window.setTimeout(cancel, 15000)
      signal.addEventListener('abort', cancel, { once: true })
      const detail: TimelineRevealRequest = { id: passage.messageId, rowId: passage.rowId, signal, complete: finish }
      viewport.dispatchEvent(new CustomEvent(TIMELINE_REVEAL_EVENT, { detail }))
    })

    source = revealed ? find(revealed) : undefined
  }

  if (!source || signal.aborted || !root.isConnected) {
    return false
  }

  source.scrollIntoView({ block: 'center' })

  return true
}
