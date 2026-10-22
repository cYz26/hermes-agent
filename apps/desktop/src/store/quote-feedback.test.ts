import { beforeEach, describe, expect, it } from 'vitest'

import {
  $quoteFeedback,
  addQuoteFeedback,
  MAX_QUOTE_CHARACTERS,
  quoteFeedbackKey,
  type QuoteFeedbackScope,
  removeQuoteFeedback,
  sanitizeQuoteFeedback,
  updateQuoteFeedback
} from './quote-feedback'

const scope: QuoteFeedbackScope = {
  connectionId: 'local',
  profile: 'default',
  targetProfile: 'default',
  sessionId: 'session-a'
}

const selection = {
  messageId: 'answer-a',
  text: '先验证核心体验。',
  start: 3,
  end: 11,
  prefix: '建议：',
  suffix: '然后讨论商业化。'
}

beforeEach(() => {
  $quoteFeedback.set({})
})

describe('pending quote feedback', () => {
  it('accumulates different passages without replacing notes or reusing removed numbers', () => {
    const key = quoteFeedbackKey(scope)
    const first = addQuoteFeedback(key, selection)!
    updateQuoteFeedback(key, first.id, '保留这一点。')
    const second = addQuoteFeedback(key, { ...selection, messageId: 'answer-b' })!
    removeQuoteFeedback(key, first.id)
    const third = addQuoteFeedback(key, { ...selection, start: 30, end: 38 })!

    expect(second.number).toBe(2)
    expect(third.number).toBe(3)
    expect($quoteFeedback.get()[key]!.items.map(item => item.messageId)).toEqual(['answer-b', 'answer-a'])
    expect($quoteFeedback.get()[key]!.items.map(item => item.number)).toEqual([2, 3])
  })

  it('deduplicates the same anchored passage without merging equal text from another message or owner', () => {
    const key = quoteFeedbackKey(scope)
    const first = addQuoteFeedback(key, selection)!
    updateQuoteFeedback(key, first.id, 'Keep my note.')
    const repeated = addQuoteFeedback(key, selection)!
    const another = addQuoteFeedback(key, { ...selection, messageId: 'answer-b' })!
    const remoteKey = quoteFeedbackKey({ ...scope, connectionId: 'remote' })
    addQuoteFeedback(remoteKey, selection)

    expect(repeated.id).toBe(first.id)
    expect(repeated.note).toBe('Keep my note.')
    expect(another.id).not.toBe(first.id)
    expect($quoteFeedback.get()[key]!.items).toHaveLength(2)
    expect($quoteFeedback.get()[remoteKey]!.items).toHaveLength(1)
  })

  it('validates persisted state without discarding unrelated valid feedback', () => {
    const key = quoteFeedbackKey(scope)
    const first = addQuoteFeedback(key, selection)!

    const value = sanitizeQuoteFeedback({
      invalid: { items: null },
      [key]: { nextNumber: 1, items: [first, { ...first, id: 12, text: null }] }
    })

    expect(value).toEqual({ [key]: { nextNumber: 2, items: [first] } })
    expect(sanitizeQuoteFeedback(null)).toEqual({})
    expect(sanitizeQuoteFeedback([])).toEqual({})
  })

  it('rejects an oversized passage without silently truncating or changing the batch', () => {
    expect(Number.isSafeInteger(MAX_QUOTE_CHARACTERS)).toBe(true)
    const key = quoteFeedbackKey(scope)
    addQuoteFeedback(key, selection)
    const before = $quoteFeedback.get()
    expect(addQuoteFeedback(key, { ...selection, text: '文'.repeat(MAX_QUOTE_CHARACTERS + 1) })).toBeNull()
    expect($quoteFeedback.get()).toBe(before)
  })
})
