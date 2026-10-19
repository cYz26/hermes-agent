import { afterEach, describe, expect, it } from 'vitest'

import { $quoteFeedback, addQuoteFeedback, quoteFeedbackKey } from './quote-feedback'
import { setConnection } from './session'
import { $sessionTiles, dropTilesForProfile, migrateTilesForProfile, openSessionTile } from './session-states'

const local = { connectionId: 'local', profile: 'writer', targetProfile: 'writer', sessionId: 'same-id' }
const remote = { ...local, connectionId: 'remote' }
const passage = { messageId: 'answer', text: 'Quoted text.', start: 0, end: 12, prefix: '', suffix: '' }

afterEach(() => {
  $quoteFeedback.set({})
  $sessionTiles.set([])
  setConnection({ connectionId: 'local', mode: 'local' } as never)
})

describe('quote feedback owner lifecycle', () => {
  it('moves pending quotes with a local profile rename without touching the same remote profile', () => {
    $quoteFeedback.set({})
    addQuoteFeedback(quoteFeedbackKey(local), passage)
    addQuoteFeedback(quoteFeedbackKey(remote), passage)
    migrateTilesForProfile('writer', 'editor')

    expect($quoteFeedback.get()[quoteFeedbackKey(local)]).toBeUndefined()
    expect(
      $quoteFeedback.get()[quoteFeedbackKey({ ...local, profile: 'editor', targetProfile: 'editor' })]!.items
    ).toHaveLength(1)
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

  it.each(['local', 'remote-ambient'])('drops backend aliases only on the ambient connection (%s)', connectionId => {
    $quoteFeedback.set({})
    setConnection({ connectionId, mode: connectionId === 'local' ? 'local' : 'remote' } as never)
    const alias = { ...local, connectionId, profile: 'desktop-alias', targetProfile: 'worker' }
    const foreign = { ...alias, connectionId: 'other-connection' }
    const unrelated = { ...alias, targetProfile: 'other-worker' }
    const scopes = [alias, foreign, unrelated]
    scopes.forEach((scope, index) => {
      addQuoteFeedback(quoteFeedbackKey(scope), passage)
      openSessionTile(`alias-${index}`, 'right', undefined, undefined, {
        ownerRoute: scope,
        workspaceMode: 'bots',
        workspaceOwnerKey: `alias-${index}`
      })
    })

    dropTilesForProfile('worker')

    expect($sessionTiles.get().some(tile => tile.storedSessionId === 'alias-0')).toBe(false)
    expect($quoteFeedback.get()[quoteFeedbackKey(alias)]).toBeUndefined()
    expect($quoteFeedback.get()[quoteFeedbackKey(foreign)]?.items).toHaveLength(1)
    expect($quoteFeedback.get()[quoteFeedbackKey(unrelated)]?.items).toHaveLength(1)
  })
})
