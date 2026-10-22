import { describe, expect, it } from 'vitest'

import { composerControlActions, composerSteeringPolicy, modifiedEnterIntent } from './input-policy'

const steeringState = {
  blockingPrompt: false,
  busy: true,
  cardWaiting: false,
  editingQueuedPrompt: false,
  hasAttachments: false,
  isSteerableText: true,
  steerSupported: true
}

describe('composer steering policy', () => {
  it('offers explicit steering for an eligible mid-turn draft', () => {
    expect(composerSteeringPolicy(steeringState)).toEqual({ canSteer: true, steeringAllowed: true })
  })

  it.each([{ busy: false }, { editingQueuedPrompt: true }, { cardWaiting: true }, { blockingPrompt: true }])(
    'blocks both steering paths for %j',
    blocker => {
      expect(composerSteeringPolicy({ ...steeringState, ...blocker })).toEqual({
        canSteer: false,
        steeringAllowed: false
      })
    }
  )

  it.each([{ steerSupported: false }, { hasAttachments: true }, { isSteerableText: false }])(
    'leaves live shortcut payload validation to the submit engine for %j',
    renderState => {
      expect(composerSteeringPolicy({ ...steeringState, ...renderState })).toEqual({
        canSteer: false,
        steeringAllowed: true
      })
    }
  )
})

describe('composer control actions', () => {
  const busyDraft = {
    busy: true,
    busyAction: 'queue' as const,
    canSteer: true,
    cardWaiting: false,
    hasComposerPayload: true
  }

  it('keeps Queue as the ordinary busy action beside explicit Steer', () => {
    expect(composerControlActions(busyDraft)).toEqual({
      showQueue: true,
      showSteerButton: true,
      showStop: false,
      showVoicePrimary: false
    })
  })

  it.each([{ busy: false }, { cardWaiting: true }])('hides Queue and Steer for %j', state => {
    expect(composerControlActions({ ...busyDraft, ...state })).toMatchObject({
      showQueue: false,
      showSteerButton: false
    })
  })

  it.each(['send', 'queue', 'stop'] as const)('keeps Stop for an empty busy composer with action %s', busyAction => {
    expect(composerControlActions({ ...busyDraft, busyAction, canSteer: false, hasComposerPayload: false })).toEqual({
      showQueue: false,
      showSteerButton: false,
      showStop: true,
      showVoicePrimary: false
    })
  })

  it.each(['send', 'stop'] as const)('does not relabel %s as Queue', busyAction => {
    expect(composerControlActions({ ...busyDraft, busyAction }).showQueue).toBe(false)
  })

  it('offers voice as the primary action only for an empty idle composer', () => {
    expect(composerControlActions({ ...busyDraft, busy: false, hasComposerPayload: false })).toEqual({
      showQueue: false,
      showSteerButton: false,
      showStop: false,
      showVoicePrimary: true
    })
  })
})

describe('modified Enter intent', () => {
  const enter = { altKey: false, ctrlKey: false, key: 'Enter', metaKey: false, shiftKey: false }

  it.each([
    ['Enter', {}, null],
    ['Shift+Enter', { shiftKey: true }, null],
    ['Alt+Enter', { altKey: true }, null],
    ['Ctrl+Enter', { ctrlKey: true }, 'queue'],
    ['Cmd+Enter', { metaKey: true }, 'queue'],
    ['Ctrl+Alt+Enter', { altKey: true, ctrlKey: true }, 'queue'],
    ['Cmd+Alt+Enter', { altKey: true, metaKey: true }, 'queue'],
    ['Ctrl+Shift+Enter', { ctrlKey: true, shiftKey: true }, 'steer'],
    ['Cmd+Shift+Enter', { metaKey: true, shiftKey: true }, 'steer'],
    ['Ctrl+Alt+Shift+Enter', { altKey: true, ctrlKey: true, shiftKey: true }, null],
    ['Cmd+Alt+Shift+Enter', { altKey: true, metaKey: true, shiftKey: true }, null],
    ['Ctrl+Shift+K', { ctrlKey: true, key: 'k', shiftKey: true }, null]
  ] as const)('recognizes %s without changing other Enter paths', (_label, modifiers, expected) => {
    expect(modifiedEnterIntent({ ...enter, ...modifiers })).toBe(expected)
  })
})
