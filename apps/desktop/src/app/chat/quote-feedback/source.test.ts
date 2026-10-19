import { afterEach, describe, expect, it, vi } from 'vitest'

import { TIMELINE_REVEAL_EVENT, type TimelineRevealRequest } from '@/components/assistant-ui/thread/timeline-data'

import { showQuoteSource } from './source'

const passage = {
  messageId: 'answer-1',
  rowId: 42,
  text: 'Original passage.',
  start: 0,
  end: 17,
  prefix: '',
  suffix: ''
}

const roots: HTMLElement[] = []

function fixture() {
  const root = document.createElement('div')
  const viewport = document.createElement('div')
  viewport.dataset.slot = 'aui_thread-viewport'
  root.append(viewport)
  document.body.append(root)
  roots.push(root)

  return { root, viewport }
}

function message(viewport: HTMLElement, id: string) {
  const element = document.createElement('div')
  element.dataset.messageId = id
  element.scrollIntoView = vi.fn()
  viewport.append(element)

  return element
}

afterEach(() => roots.splice(0).forEach(root => root.remove()))

describe('quote source navigation', () => {
  it('returns to the mounted source without consulting another chat surface', async () => {
    const { root, viewport } = fixture()
    const target = message(viewport, passage.messageId)
    const other = message(fixture().viewport, passage.messageId)

    expect(await showQuoteSource(root, passage, new AbortController().signal)).toBe(true)
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(other.scrollIntoView).not.toHaveBeenCalled()
  })

  it('uses the existing timeline reveal contract for a paged-out source or a rehydrated message id', async () => {
    const { root, viewport } = fixture()
    let target: HTMLElement | undefined

    const reveal = vi.fn((event: Event) => {
      const request = (event as CustomEvent<TimelineRevealRequest>).detail
      expect(request.id).toBe(passage.messageId)
      expect(request.rowId).toBe(passage.rowId)
      target = message(viewport, 'history:42')
      request.complete('history:42')
    })

    viewport.addEventListener(TIMELINE_REVEAL_EVENT, reveal)

    expect(await showQuoteSource(root, passage, new AbortController().signal)).toBe(true)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(target!.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('cancels an outstanding jump without scrolling a late source after a session switch', async () => {
    const { root, viewport } = fixture()
    const controller = new AbortController()
    let complete: TimelineRevealRequest['complete'] | undefined
    viewport.addEventListener(TIMELINE_REVEAL_EVENT, event => {
      complete = (event as CustomEvent<TimelineRevealRequest>).detail.complete
    })
    const pending = showQuoteSource(root, passage, controller.signal)
    controller.abort()
    const target = message(viewport, passage.messageId)
    complete?.(passage.messageId)

    expect(await pending).toBe(false)
    expect(target.scrollIntoView).not.toHaveBeenCalled()
  })

  it('reports an unavailable source while leaving the saved quote intact', async () => {
    const { root, viewport } = fixture()
    viewport.addEventListener(TIMELINE_REVEAL_EVENT, event => {
      const request = (event as CustomEvent<TimelineRevealRequest>).detail
      request.complete(false)
    })

    expect(await showQuoteSource(root, passage, new AbortController().signal)).toBe(false)
    expect(passage.text).toBe('Original passage.')
  })
})
