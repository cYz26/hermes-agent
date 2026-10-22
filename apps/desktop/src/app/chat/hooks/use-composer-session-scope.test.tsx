import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sessionRoute } from '@/app/routes'
import * as composerStore from '@/store/composer'
import * as queueStore from '@/store/composer-queue'

import { useComposerSessionScope } from './use-composer-session-scope'

vi.mock('@/store/composer', async importOriginal => ({
  ...await importOriginal<typeof composerStore>(),
  migrateSessionDraft: vi.fn()
}))
vi.mock('@/store/composer-queue', async importOriginal => ({
  ...await importOriginal<typeof queueStore>(),
  migrateQueuedPrompts: vi.fn(),
  parkQueuedPrompts: vi.fn()
}))

beforeEach(() => vi.clearAllMocks())

describe('composer conversation scope lifecycle', () => {
  it('migrates only a same-lineage tip, not a stale selection after navigation', () => {
    const onCancel = vi.fn()

    const props = {
      primary: true, pathname: sessionRoute('tip'), selectedId: 'tip', runtimeId: 'runtime',
      freshDraftKey: 'draft', sessions: [{ id: 'tip', _lineage_root_id: 'root' }], onCancel
    }

    const { result, rerender } = renderHook(useComposerSessionScope, { initialProps: props })

    expect(result.current.queueSessionKey).toBe('root')
    expect(result.current.feedbackSessionKey).toBe('root')
    expect(composerStore.migrateSessionDraft).toHaveBeenCalledWith('tip', 'root')
    expect(queueStore.migrateQueuedPrompts).toHaveBeenCalledWith('tip', 'root')
    vi.clearAllMocks()
    rerender({ ...props, pathname: sessionRoute('different') })
    expect(result.current.queueSessionKey).toBe('different')
    expect(composerStore.migrateSessionDraft).not.toHaveBeenCalled()
    expect(queueStore.migrateQueuedPrompts).not.toHaveBeenCalled()
    result.current.haltRun()
    expect(queueStore.parkQueuedPrompts).toHaveBeenCalledWith('different')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(vi.mocked(queueStore.parkQueuedPrompts).mock.invocationCallOrder[0]).toBeLessThan(onCancel.mock.invocationCallOrder[0]!)
  })

  it('keeps tiles on their own session and fresh chats on the unsent draft', () => {
    const props = {
      primary: false, pathname: sessionRoute('unrelated'), selectedId: 'tile', runtimeId: 'runtime',
      freshDraftKey: 'draft', sessions: [], onCancel: vi.fn()
    }

    const { result, rerender } = renderHook(useComposerSessionScope, { initialProps: props })

    expect(result.current.queueSessionKey).toBe('tile')
    rerender({ ...props, primary: true, pathname: '/' })
    expect(result.current.queueSessionKey).toBeNull()
    expect(result.current.feedbackSessionKey).toBe('draft')
  })
})
