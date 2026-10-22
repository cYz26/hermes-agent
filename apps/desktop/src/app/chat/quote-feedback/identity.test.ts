import { describe, expect, it } from 'vitest'

import { resolveQuoteFeedbackScope } from './identity'

const base = {
  activeProfile: 'foreground',
  connectionId: 'local',
  composer: {},
  storedId: 'stored'
}

describe('quote feedback surface ownership', () => {
  it('keeps the desktop owner and backend target distinct from the foreground', () => {
    expect(resolveQuoteFeedbackScope({
      ...base,
      composer: { connectionId: 'remote-owner', profile: 'backend-target' },
      owner: { connectionId: 'remote-owner', profile: 'desktop-alias', targetProfile: 'backend-target' },
      feedbackSessionKey: 'lineage-root'
    })).toEqual({
      connectionId: 'remote-owner', profile: 'desktop-alias', targetProfile: 'backend-target', sessionId: 'lineage-root'
    })
  })

  it('falls back to the stored conversation and only then the new-chat scope', () => {
    expect(resolveQuoteFeedbackScope(base)).toEqual({
      connectionId: 'local', profile: 'foreground', targetProfile: 'foreground', sessionId: 'stored'
    })
    expect(resolveQuoteFeedbackScope({ ...base, connectionId: '', storedId: null })).toEqual({
      connectionId: null, profile: 'foreground', targetProfile: 'foreground', sessionId: 'new'
    })
  })

  it('retains the existing empty-versus-absent fallback rules', () => {
    expect(resolveQuoteFeedbackScope({
      ...base,
      composer: { connectionId: '', profile: '' },
      owner: { connectionId: 'owner', profile: 'alias', targetProfile: '' },
      feedbackSessionKey: ''
    })).toEqual({ connectionId: '', profile: 'alias', targetProfile: '', sessionId: '' })
  })
})
