import { describe, expect, it } from 'vitest'

import { type BusySubmitInputs, deriveBusySubmitState } from './busy-submit-state'

const ordinary: BusySubmitInputs = {
  attachmentCount: 0,
  blockingPrompt: false,
  busy: true,
  busyInputMode: 'queue',
  cardWaiting: false,
  compacting: false,
  hasComposerPayload: true,
  hasSteerHandler: true,
  isSlashCommand: false,
  isSteerableText: true,
  queueEditing: false
}

describe('busy composer affordances', () => {
  it('keeps Queue primary and Steer independently available for an ordinary follow-up', () => {
    expect(deriveBusySubmitState(ordinary)).toEqual({ busyAction: 'queue', canSteer: true, canSubmit: true })
  })

  it('labels an inline slash command Send rather than Queue', () => {
    expect(deriveBusySubmitState({ ...ordinary, isSlashCommand: true, isSteerableText: false })).toEqual({
      busyAction: 'send', canSteer: false, canSubmit: true
    })
  })

  it.each(['cardWaiting', 'queueEditing', 'blockingPrompt'] as const)('blocks draft Steer while %s owns the draft', key => {
    expect(deriveBusySubmitState({ ...ordinary, [key]: true }).canSteer).toBe(false)
  })

  it('keeps attachment payloads queued, not steerable', () => {
    expect(deriveBusySubmitState({ ...ordinary, attachmentCount: 1 })).toEqual({
      busyAction: 'queue', canSteer: false, canSubmit: true
    })
  })

  it('retains the upstream explicit busy-mode resolver for non-Queue callers', () => {
    for (const busyInputMode of ['interrupt', 'steer'] as const) {
      expect(deriveBusySubmitState({ ...ordinary, busyInputMode }).busyAction).toBe(busyInputMode)
    }

    expect(deriveBusySubmitState({ ...ordinary, busyInputMode: null }).canSubmit).toBe(false)
  })
})
