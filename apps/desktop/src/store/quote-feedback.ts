import { Codecs, persistentAtom } from '@/lib/persisted'

export interface QuoteFeedbackScope {
  connectionId: string | null
  profile: string
  targetProfile: string
  sessionId: string
}

/** Offsets address rendered text, never raw Markdown or retained DOM nodes. */
export interface QuotedPassage {
  messageId: string
  rowId?: number
  text: string
  start: number
  end: number
  prefix: string
  suffix: string
}

export interface QuoteFeedbackItem extends QuotedPassage {
  id: string
  number: number
  note: string
}

export interface QuoteFeedbackBatch {
  nextNumber: number
  items: QuoteFeedbackItem[]
}

export const MAX_QUOTE_CHARACTERS = 16_000
export const EMPTY_QUOTE_FEEDBACK: QuoteFeedbackBatch = { nextNumber: 1, items: [] }
export const quoteFeedbackKey = (scope: QuoteFeedbackScope): string =>
  JSON.stringify([scope.connectionId, scope.profile, scope.targetProfile, scope.sessionId])

function decodeScope(key: string): QuoteFeedbackScope | null {
  try {
    const value: unknown = JSON.parse(key)

    if (
      !Array.isArray(value) || value.length !== 4 ||
      (value[0] !== null && typeof value[0] !== 'string') ||
      !value.slice(1).every(part => typeof part === 'string' && part.length > 0)
    ) {
      return null
    }

    const [connectionId, profile, targetProfile, sessionId] = value as [string | null, string, string, string]

    return { connectionId, profile, targetProfile, sessionId }
  } catch {
    return null
  }
}

function isFeedbackItem(value: unknown): value is QuoteFeedbackItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as QuoteFeedbackItem

  return [item.id, item.messageId, item.text].every(text => typeof text === 'string' && text.trim().length > 0) &&
    [item.note, item.prefix, item.suffix].every(text => typeof text === 'string') &&
    Number.isSafeInteger(item.number) && item.number > 0 &&
    Number.isSafeInteger(item.start) && item.start >= 0 && Number.isSafeInteger(item.end) && item.end >= item.start &&
    (item.rowId === undefined || (Number.isSafeInteger(item.rowId) && item.rowId > 0))
}

/** localStorage is input too; a corrupt scope must not blank every other draft. */
export function sanitizeQuoteFeedback(value: unknown): Record<string, QuoteFeedbackBatch> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, QuoteFeedbackBatch> = {}

  for (const [key, saved] of Object.entries(value)) {
    if (!decodeScope(key) || !saved || typeof saved !== 'object' || !Array.isArray(saved.items)) {
      continue
    }

    const items = saved.items.filter(isFeedbackItem) as QuoteFeedbackItem[]
    const minimum = items.reduce((next, item) => Math.max(next, item.number + 1), 1)
    result[key] = { items, nextNumber: Number.isSafeInteger(saved.nextNumber) ? Math.max(saved.nextNumber, minimum) : minimum }
  }

  return result
}

export const $quoteFeedback = persistentAtom<Record<string, QuoteFeedbackBatch>>(
  'hermes.desktop.quoteFeedback.v1',
  {},
  Codecs.json(sanitizeQuoteFeedback)
)

export function addQuoteFeedback(key: string, passage: QuotedPassage): QuoteFeedbackItem | null {
  if (!passage.text.trim() || passage.text.length > MAX_QUOTE_CHARACTERS) {
    return null
  }

  const batches = $quoteFeedback.get()
  const batch = batches[key] ?? EMPTY_QUOTE_FEEDBACK

  const existing = batch.items.find(item =>
    (item.rowId !== undefined && passage.rowId !== undefined ? item.rowId === passage.rowId : item.messageId === passage.messageId) &&
    item.start === passage.start && item.end === passage.end && item.text === passage.text
  )

  if (existing) {
    return existing
  }

  const item: QuoteFeedbackItem = { ...passage, id: crypto.randomUUID(), number: batch.nextNumber, note: '' }
  $quoteFeedback.set({ ...batches, [key]: { nextNumber: batch.nextNumber + 1, items: [...batch.items, item] } })

  return item
}

export function updateQuoteFeedback(key: string, id: string, note: string): void {
  const batches = $quoteFeedback.get()
  const batch = batches[key]

  if (batch) {
    const items = batch.items.map(item => (item.id === id ? { ...item, note } : item))
    $quoteFeedback.set({ ...batches, [key]: { ...batch, items } })
  }
}

export function removeQuoteFeedback(key: string, id: string): void {
  const batches = $quoteFeedback.get()
  const batch = batches[key]

  if (batch) {
    $quoteFeedback.set({ ...batches, [key]: { ...batch, items: batch.items.filter(item => item.id !== id) } })
  }
}

function mergeFeedbackBatches(existing: QuoteFeedbackBatch | undefined, batch: QuoteFeedbackBatch): QuoteFeedbackBatch {
  if (!existing) {
    return batch
  }

  const extra = batch.items.filter(item => !existing.items.some(saved => saved.id === item.id))
  const start = existing.nextNumber

  return {
    nextNumber: start + extra.length,
    items: [...existing.items, ...extra.map((item, index) => ({ ...item, number: start + index }))]
  }
}

/** Rekey only this owner's conversation; callers prove same-lineage identity. */
export function migrateQuoteFeedbackSession(scope: QuoteFeedbackScope, fromSessionId: string): void {
  const from = quoteFeedbackKey({ ...scope, sessionId: fromSessionId })
  const to = quoteFeedbackKey(scope)
  const batches = $quoteFeedback.get()
  const batch = batches[from]

  if (from === to || !batch) {
    return
  }

  const next = { ...batches, [to]: mergeFeedbackBatches(batches[to], batch) }
  delete next[from]
  $quoteFeedback.set(next)
}

export function dropQuoteFeedbackForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string },
  ambientConnection = 'local'
): void {
  const next = Object.fromEntries(Object.entries($quoteFeedback.get()).filter(([key]) => {
    const scope = decodeScope(key)

    if (!scope) {
      return false
    }

    const matches = route
      ? scope.profile === route.profile?.trim() &&
        (!route.targetProfile || scope.targetProfile === route.targetProfile.trim()) &&
        (!route.connectionId || scope.connectionId === route.connectionId.trim())
      : (scope.connectionId ?? 'local') === ambientConnection &&
        (scope.profile === profile || scope.targetProfile === profile)

    return !matches
  }))

  $quoteFeedback.set(next)
}

export function migrateQuoteFeedbackForProfile(from: string, to: string): void {
  const batches = $quoteFeedback.get()
  const next = { ...batches }

  for (const [key, batch] of Object.entries(batches)) {
    const scope = decodeScope(key)

    if (!scope || (scope.connectionId !== null && scope.connectionId !== 'local')) {
      continue
    }

    const renamed = quoteFeedbackKey({
      ...scope,
      profile: scope.profile === from ? to : scope.profile,
      targetProfile: scope.targetProfile === from ? to : scope.targetProfile
    })

    if (renamed === key) {
      continue
    }

    next[renamed] = mergeFeedbackBatches(next[renamed], batch)
    delete next[key]
  }

  $quoteFeedback.set(next)
}
