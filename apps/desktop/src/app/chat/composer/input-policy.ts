interface ComposerSteeringState {
  blockingPrompt: boolean
  busy: boolean
  cardWaiting: boolean
  editingQueuedPrompt: boolean
  hasAttachments: boolean
  isSteerableText: boolean
  steerSupported: boolean
}

// Steer only makes sense mid-turn, text-only (the gateway can't carry images
// into a tool result) and never for a slash command (those execute inline).
// A blocking prompt (approval/sudo/secret) also rules it out: the tool batch
// is parked on the user, so a steer can't reach the model — text queues.
// Compaction does not: the gateway holds the correction until it finishes.
export function composerSteeringPolicy({
  blockingPrompt,
  busy,
  cardWaiting,
  editingQueuedPrompt,
  hasAttachments,
  isSteerableText,
  steerSupported
}: ComposerSteeringState) {
  const steeringAllowed = busy && !editingQueuedPrompt && !cardWaiting && !blockingPrompt

  return {
    canSteer: steeringAllowed && steerSupported && !hasAttachments && isSteerableText,
    // Shortcuts validate the live draft in the submit engine, not the render-lagged payload.
    steeringAllowed
  }
}

interface ComposerControlState {
  busy: boolean
  busyAction: 'send' | 'queue' | 'stop'
  canSteer: boolean
  cardWaiting: boolean
  hasComposerPayload: boolean
}

export function composerControlActions({
  busy,
  busyAction,
  canSteer,
  cardWaiting,
  hasComposerPayload
}: ComposerControlState) {
  // A waiting card takes its answer immediately; steering never shares the default send action.
  return {
    showQueue: busy && busyAction === 'queue' && hasComposerPayload && !cardWaiting,
    showSteerButton: busy && canSteer && !cardWaiting,
    showStop: busy && !hasComposerPayload,
    showVoicePrimary: !busy && !hasComposerPayload
  }
}

export function modifiedEnterIntent(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
): 'queue' | 'steer' | null {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
    return null
  }

  // Preserve the Queue alias with Alt; Alt must never opt into steering.
  if (!event.shiftKey) {
    return 'queue'
  }

  return event.altKey ? null : 'steer'
}
