import { describe, expect, it } from 'vitest'

import { renameLocalSessionOwner } from './session-owner-rename'

describe('local session owner rename', () => {
  it('renames both local owner fields while preserving route metadata', () => {
    expect(renameLocalSessionOwner({ connectionId: 'local', mode: 'local', profile: ' old ', targetProfile: 'old' }, 'old', 'new'))
      .toEqual({ connectionId: 'local', mode: 'local', profile: 'new', targetProfile: 'new' })
  })

  it('does not rename a same-named remote owner', () => {
    const owner = { connectionId: 'remote', profile: 'old', targetProfile: 'old' }
    expect(renameLocalSessionOwner(owner, 'old', 'new')).toBe(owner)
  })

  it('preserves absent and unrelated local owners by reference', () => {
    const owner = { connectionId: 'local', profile: 'other' }
    expect(renameLocalSessionOwner(undefined, 'old', 'new')).toBeUndefined()
    expect(renameLocalSessionOwner(owner, 'old', 'new')).toBe(owner)
    expect(renameLocalSessionOwner({ connectionId: '', profile: 'old' }, 'old', 'new'))
      .toEqual({ connectionId: '', profile: 'new' })
  })
})
