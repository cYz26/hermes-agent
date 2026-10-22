import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const passage = { messageId: 'answer', text: 'Saved snapshot', start: 0, end: 14, prefix: '', suffix: '' }
const owner = { profile: 'desktop-alias', targetProfile: 'backend-target' }

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})
afterEach(() => window.localStorage.clear())

describe('public profile deletion and persisted quote scopes', () => {
  it.each([
    { connection: { connectionId: 'source-a', mode: 'remote' }, connectionId: 'source-a' },
    { connection: { connectionId: 'local', mode: 'local' }, connectionId: 'local' },
    { connection: { mode: 'remote', baseUrl: 'http://fixture.invalid' }, connectionId: 'url:http://fixture.invalid' }
  ])(
    'drops ambient owner OR target matches only on $connectionId, including after reload',
    async ({ connection, connectionId }) => {
      const session = await import('./session')
      session.$connection.set(connection as never)
      const storage = await import('@/lib/storage')
      const targetOwner = { ...owner, connectionId }
      const foreignOwner = { ...owner, connectionId: 'source-b' }
      storage.writeJson('hermes.desktop.sessionTiles.v2', {
        __bots_workspace__: [
          { storedSessionId: 'deleted-tile', workspaceMode: 'bots', ownerRoute: targetOwner },
          { storedSessionId: 'foreign-tile', workspaceMode: 'bots', ownerRoute: foreignOwner }
        ]
      })
      const tiles = await import('./session-states')
      const quotes = await import('./quote-feedback')

      const deletedScopes = [
        { ...targetOwner, sessionId: 'same-id' },
        { connectionId, profile: owner.targetProfile, targetProfile: 'another-target', sessionId: 'same-id' },
        ...(connectionId === 'local' ? [{ ...owner, connectionId: null, sessionId: 'same-id' }] : [])
      ]

      const keptScopes = [
        { ...foreignOwner, sessionId: 'same-id' },
        { connectionId, profile: 'unrelated', targetProfile: 'unrelated', sessionId: 'same-id' },
        ...(connectionId !== 'local' ? [{ ...owner, connectionId: null, sessionId: 'same-id' }] : [])
      ]

      const deleted = deletedScopes.map(quotes.quoteFeedbackKey)
      const kept = keptScopes.map(quotes.quoteFeedbackKey)

      for (const key of [...deleted, ...kept]) {
        const item = quotes.addQuoteFeedback(key, passage)!
        quotes.updateQuoteFeedback(key, item.id, 'Persisted note')
      }

      tiles.dropTilesForProfile(owner.targetProfile)

      expect(tiles.$sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['foreign-tile'])
      expect(Object.keys(quotes.$quoteFeedback.get()).sort()).toEqual([...kept].sort())
      expect(deleted.every(key => quotes.$quoteFeedback.get()[key] === undefined)).toBe(true)
      const expected = quotes.$quoteFeedback.get()
      vi.resetModules()
      const reloadedQuotes = await import('./quote-feedback')
      const reloadedTiles = await import('./session-states')
      expect(reloadedQuotes.$quoteFeedback.get()).toEqual(expected)
      expect(reloadedTiles.$sessionTiles.get().map(tile => tile.storedSessionId)).toEqual(['foreign-tile'])
      expect(kept.map(key => reloadedQuotes.$quoteFeedback.get()[key]?.items[0]?.note)).toEqual(
        kept.map(() => 'Persisted note')
      )
    }
  )

  it('retains exact owner/target matching for an explicit route rather than using ambient OR matching', async () => {
    const session = await import('./session')
    session.$connection.set({ connectionId: 'unrelated-source', mode: 'remote' } as never)
    const tiles = await import('./session-states')
    const quotes = await import('./quote-feedback')
    const route = { ...owner, connectionId: 'source-a' }

    const scopes = [
      route,
      { ...route, profile: 'other-alias' },
      { ...route, targetProfile: 'other-target' },
      { ...route, connectionId: 'source-b' }
    ].map(scope => ({ ...scope, sessionId: 'same-id' }))

    const keys = scopes.map(quotes.quoteFeedbackKey)
    keys.forEach(key => quotes.addQuoteFeedback(key, passage))

    tiles.dropTilesForProfile(owner.targetProfile, route)

    expect(Object.keys(quotes.$quoteFeedback.get())).toEqual(keys.slice(1))
    vi.resetModules()
    expect((await import('./quote-feedback')).$quoteFeedback.get()).toEqual(
      Object.fromEntries(keys.slice(1).map(key => [key, quotes.$quoteFeedback.get()[key]]))
    )
  })
})
