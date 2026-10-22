import { afterEach, describe, expect, it } from 'vitest'

import { $quoteFeedback, addQuoteFeedback, quoteFeedbackKey } from './quote-feedback'
import { dropTilesForProfile, migrateTilesForProfile } from './session-states'

const local = { connectionId: 'local', profile: 'writer', targetProfile: 'writer', sessionId: 'same-id' }
const remote = { ...local, connectionId: 'remote' }
const passage = { messageId: 'answer', text: 'Quoted text.', start: 0, end: 12, prefix: '', suffix: '' }

afterEach(() => $quoteFeedback.set({}))

describe('quote feedback owner lifecycle', () => {
  it('moves pending quotes with a local profile rename without touching the same remote profile', () => {
    $quoteFeedback.set({})
    addQuoteFeedback(quoteFeedbackKey(local), passage)
    addQuoteFeedback(quoteFeedbackKey(remote), passage)
    migrateTilesForProfile('writer', 'editor')

    expect($quoteFeedback.get()[quoteFeedbackKey(local)]).toBeUndefined()
    expect($quoteFeedback.get()[quoteFeedbackKey({ ...local, profile: 'editor', targetProfile: 'editor' })]!.items).toHaveLength(1)
    expect($quoteFeedback.get()[quoteFeedbackKey(remote)]!.items).toHaveLength(1)
  })

  it('drops only the deleted connection-qualified profile’s pending feedback', () => {
    $quoteFeedback.set({})
    addQuoteFeedback(quoteFeedbackKey(local), passage)
    addQuoteFeedback(quoteFeedbackKey(remote), passage)
    dropTilesForProfile('writer', { connectionId: 'remote', profile: 'writer', targetProfile: 'writer' })

    expect($quoteFeedback.get()[quoteFeedbackKey(remote)]).toBeUndefined()
    expect($quoteFeedback.get()[quoteFeedbackKey(local)]!.items).toHaveLength(1)
  })
})
