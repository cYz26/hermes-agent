import { atom } from 'nanostores'

import type { QuoteFeedbackBatch } from './quote-feedback'

type FeedbackRecord = Record<string, QuoteFeedbackBatch>

const LEGACY_KEY = 'hermes.desktop.quoteFeedback.v1'
const SCOPE_PREFIX = 'hermes.desktop.quoteFeedback.v2.'

function parse(raw: string | null): unknown {
  try {
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Scope keys never share a write, even when two renderers mutate concurrently. */
export function createQuoteFeedbackPersistence(sanitize: (value: unknown) => FeedbackRecord) {
  let cached: FeedbackRecord = {}
  const unsaved = new Map<string, QuoteFeedbackBatch | null>()

  const load = (): FeedbackRecord => {
    let result: FeedbackRecord

    try {
      const storage = window.localStorage
      // Legacy data stays untouched. A v2 value (including a deletion tombstone)
      // is authoritative, so reloads cannot import removed v1 quotes again.
      result = sanitize(parse(storage.getItem(LEGACY_KEY)))

      for (let index = 0; index < storage.length; index++) {
        const storageKey = storage.key(index)

        if (!storageKey?.startsWith(SCOPE_PREFIX)) {
          continue
        }

        const key = storageKey.slice(SCOPE_PREFIX.length)
        const value = parse(storage.getItem(storageKey))

        if (value === null) {
          delete result[key]
        } else {
          Object.assign(result, sanitize({ [key]: value }))
        }
      }
    } catch {
      result = { ...cached }
    }

    for (const [key, batch] of unsaved) {
      if (batch === null) {
        delete result[key]
      } else {
        result[key] = batch
      }
    }

    return result
  }

  const $batches = atom<FeedbackRecord>(load())
  const publish = $batches.set.bind($batches)
  cached = $batches.get()

  const refresh = (): FeedbackRecord => {
    const next = load()
    const previous = $batches.get()

    for (const key of Object.keys(next)) {
      if (JSON.stringify(next[key]) === JSON.stringify(previous[key])) {
        next[key] = previous[key]
      }
    }

    if (
      Object.keys(next).length !== Object.keys(previous).length ||
      Object.keys(next).some(key => next[key] !== previous[key])
    ) {
      cached = next
      publish(next)
    }

    return $batches.get()
  }

  const save = (key: string, batch: QuoteFeedbackBatch | null): boolean => {
    try {
      window.localStorage.setItem(SCOPE_PREFIX + key, JSON.stringify(batch))
      unsaved.delete(key)

      return true
    } catch {
      // A quota/permission failure must not discard this window's unsent work.
      unsaved.set(key, batch)

      return false
    }
  }

  $batches.set = value => {
    const next = sanitize(value)
    const previous = $batches.get()
    const writes = new Map(unsaved)
    let saved = true

    for (const [key, batch] of Object.entries(next)) {
      if (JSON.stringify(batch) !== JSON.stringify(previous[key])) {
        writes.set(key, batch)
      }
    }

    for (const key of Object.keys(previous)) {
      if (!(key in next)) {
        writes.set(key, null)
      }
    }

    // A failed migration hides its source in memory. Carry that retirement into
    // later edits/deletions too, but never retire it before destinations are durable.
    for (const [key, batch] of writes) {
      if (batch !== null) {
        saved = save(key, batch) && saved
      }
    }

    for (const [key, batch] of writes) {
      if (batch === null) {
        if (saved) {
          save(key, null)
        } else {
          unsaved.set(key, null)
        }
      }
    }

    refresh()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      if (event.key === null || event.key === LEGACY_KEY || event.key.startsWith(SCOPE_PREFIX)) {
        // Read current storage, not a possibly delayed event's stale payload.
        refresh()
      }
    })
  }

  return { $batches, current: refresh }
}
