import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const legacyKey = 'hermes.desktop.quoteFeedback.v1'
const scopePrefix = 'hermes.desktop.quoteFeedback.v2.'
const scope = { connectionId: 'local', profile: 'writer', targetProfile: 'worker', sessionId: 'tip' }
const passage = { messageId: 'answer', text: 'Shared snapshot', start: 0, end: 15, prefix: '', suffix: '' }

let storageListeners: EventListener[] = []

async function independentRenderer() {
  vi.resetModules()

  return import('./quote-feedback')
}

beforeEach(() => {
  window.localStorage.clear()
  storageListeners = []
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'storage' && typeof listener === 'function') {
      storageListeners.push(listener as EventListener)
    }

    add(type, listener, options)
  })
})

afterEach(() => {
  storageListeners.forEach(listener => window.removeEventListener('storage', listener))
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('quote feedback across independent renderers sharing storage', () => {
  it('preserves different scopes written by renderers booted from the same empty snapshot', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const a = await independentRenderer()
    const b = await independentRenderer()
    expect(a.$quoteFeedback).not.toBe(b.$quoteFeedback)
    expect(writes).not.toHaveBeenCalled()
    const aKey = a.quoteFeedbackKey(scope)
    const bKey = b.quoteFeedbackKey({ ...scope, connectionId: 'remote', profile: 'other' })
    const first = a.addQuoteFeedback(aKey, passage)!
    expect(b.$quoteFeedback.get()[aKey]).toBeUndefined()
    const second = b.addQuoteFeedback(bKey, passage)!
    const reloaded = await independentRenderer()

    expect(reloaded.$quoteFeedback.get()[aKey]?.items).toEqual([first])
    expect(reloaded.$quoteFeedback.get()[bKey]?.items).toEqual([second])
    expect(window.localStorage.getItem(legacyKey)).toBeNull()
  })

  it('isolates scope writes even if another renderer writes after our read but before our save', async () => {
    const a = await independentRenderer()
    const b = await independentRenderer()
    const aKey = a.quoteFeedbackKey(scope)
    const bKey = b.quoteFeedbackKey({ ...scope, connectionId: 'remote' })
    const setItem = Storage.prototype.setItem
    let interleaved = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (!interleaved && key.startsWith('hermes.desktop.quoteFeedback.')) {
        interleaved = true
        b.addQuoteFeedback(bKey, { ...passage, messageId: 'B answer' })
      }

      setItem.call(this, key, value)
    })
    a.addQuoteFeedback(aKey, passage)
    const reloaded = await independentRenderer()

    expect(interleaved).toBe(true)
    expect(reloaded.$quoteFeedback.get()[aKey]?.items[0]?.messageId).toBe('answer')
    expect(reloaded.$quoteFeedback.get()[bKey]?.items[0]?.messageId).toBe('B answer')
  })

  it('adopts current storage on change and clear events without echoing stale event payloads', async () => {
    const a = await independentRenderer()
    const b = await independentRenderer()
    const key = a.quoteFeedbackKey(scope)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const item = a.addQuoteFeedback(key, passage)!
    a.updateQuoteFeedback(key, item.id, 'newest note')
    const beforeEvent = writes.mock.calls.length
    expect(b.$quoteFeedback.get()[key]).toBeUndefined()
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: scopePrefix + key,
        newValue: JSON.stringify({ nextNumber: 2, items: [item] })
      })
    )

    expect(b.$quoteFeedback.get()[key]?.items[0]?.note).toBe('newest note')
    expect(writes.mock.calls).toHaveLength(beforeEvent)
    a.dropQuoteFeedbackForProfile('worker')
    const beforeStaleEdit = writes.mock.calls.length
    b.updateQuoteFeedback(key, item.id, 'stale note after deletion')
    b.removeQuoteFeedback(key, item.id)
    expect(b.$quoteFeedback.get()[key]).toBeUndefined()
    expect(writes.mock.calls).toHaveLength(beforeStaleEdit)
    const otherKey = b.quoteFeedbackKey({ ...scope, profile: 'other', targetProfile: 'other' })
    b.addQuoteFeedback(otherKey, passage)
    window.localStorage.clear()
    const beforeClearEvent = writes.mock.calls.length
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(a.$quoteFeedback.get()).toEqual({})
    expect(b.$quoteFeedback.get()).toEqual({})
    expect(writes.mock.calls).toHaveLength(beforeClearEvent)
  })

  it.each([
    ['legacy', 'delete'],
    ['v2', 'delete'],
    ['legacy', 'edit'],
    ['v2', 'edit']
  ] as const)('retires a failed %s migration after a successful %s', async (layout, operation) => {
    const a = await independentRenderer()
    const source = a.quoteFeedbackKey(scope)
    const destination = a.quoteFeedbackKey({ ...scope, sessionId: 'root' })
    const foreign = a.quoteFeedbackKey({ ...scope, connectionId: 'remote' })
    const item = { ...passage, id: 'unsaved-migration', number: 3, note: 'keep until durable' }
    const batch = { nextNumber: 4, items: [item] }
    const legacy = JSON.stringify({ [source]: batch, [foreign]: batch })

    if (layout === 'legacy') {
      window.localStorage.setItem(legacyKey, legacy)
    } else {
      window.localStorage.setItem(scopePrefix + source, JSON.stringify(batch))
      window.localStorage.setItem(scopePrefix + foreign, JSON.stringify(batch))
    }

    const setItem = Storage.prototype.setItem

    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === scopePrefix + destination) {
        throw new DOMException('Destination quota exceeded', 'QuotaExceededError')
      }

      setItem.call(this, key, value)
    })

    a.migrateQuoteFeedbackSession({ ...scope, sessionId: 'root' }, scope.sessionId)
    expect(a.$quoteFeedback.get()[source]).toBeUndefined()
    expect(a.$quoteFeedback.get()[destination]).toEqual(batch)
    const beforeRecovery = await independentRenderer()
    expect(beforeRecovery.$quoteFeedback.get()[source]).toEqual(batch)
    expect(beforeRecovery.$quoteFeedback.get()[destination]).toBeUndefined()
    blocked.mockRestore()

    if (operation === 'delete') {
      a.dropQuoteFeedbackForProfile(scope.profile)
    } else {
      a.updateQuoteFeedback(destination, item.id, 'durable root note')
    }

    const reloaded = await independentRenderer()
    expect(reloaded.$quoteFeedback.get()[source]).toBeUndefined()
    expect(reloaded.$quoteFeedback.get()[foreign]).toEqual(batch)

    if (operation === 'delete') {
      expect(reloaded.$quoteFeedback.get()[destination]).toBeUndefined()
    } else {
      expect(reloaded.$quoteFeedback.get()[destination]?.items).toEqual([{ ...item, note: 'durable root note' }])
    }

    if (layout === 'legacy') {
      expect(window.localStorage.getItem(legacyKey)).toBe(legacy)
    }
  })

  it.each(['session', 'profile'] as const)(
    'preserves legacy v1 non-destructively and never reimports a %s migration source',
    async kind => {
      const key = JSON.stringify([scope.connectionId, scope.profile, scope.targetProfile, scope.sessionId])
      const item = { ...passage, id: 'legacy-quote', number: 3, note: 'legacy unsent note' }
      const raw = JSON.stringify({ [key]: { nextNumber: 4, items: [item] }, corrupt: { items: null } })
      window.localStorage.setItem(legacyKey, raw)
      const writes = vi.spyOn(Storage.prototype, 'setItem')
      const a = await independentRenderer()
      const b = await independentRenderer()
      expect(writes).not.toHaveBeenCalled()
      expect(b.$quoteFeedback.get()[key]?.items).toEqual([item])
      const destination = kind === 'session' ? { ...scope, sessionId: 'root' } : { ...scope, profile: 'renamed' }

      const migrate = () =>
        kind === 'session'
          ? a.migrateQuoteFeedbackSession(destination, scope.sessionId)
          : a.migrateQuoteFeedbackForProfile(scope.profile, destination.profile)

      migrate()
      const afterMigration = writes.mock.calls.length
      migrate()
      b.updateQuoteFeedback(key, item.id, 'stale edit')
      expect(writes.mock.calls).toHaveLength(afterMigration)
      const foreignKey = b.quoteFeedbackKey({ ...scope, connectionId: 'remote' })
      b.addQuoteFeedback(foreignKey, passage)
      const reloaded = await independentRenderer()
      const destinationKey = a.quoteFeedbackKey(destination)

      expect(reloaded.$quoteFeedback.get()[key]).toBeUndefined()
      expect(reloaded.$quoteFeedback.get()[destinationKey]).toEqual({ nextNumber: 4, items: [item] })
      expect(reloaded.$quoteFeedback.get()[foreignKey]?.items).toHaveLength(1)
      expect(window.localStorage.getItem(legacyKey)).toBe(raw)
      a.dropQuoteFeedbackForProfile(destination.profile)
      const afterDeletion = await independentRenderer()
      expect(afterDeletion.$quoteFeedback.get()[key]).toBeUndefined()
      expect(afterDeletion.$quoteFeedback.get()[destinationKey]).toBeUndefined()
      expect(afterDeletion.$quoteFeedback.get()[foreignKey]?.items).toHaveLength(1)
      expect(window.localStorage.getItem(legacyKey)).toBe(raw)
    }
  )
})
