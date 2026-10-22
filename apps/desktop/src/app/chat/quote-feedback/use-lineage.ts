import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'

import { migrateQuoteFeedbackSession, type QuoteFeedbackScope } from '@/store/quote-feedback'
import { $sessions, shouldMigrateComposerScope } from '@/store/session'

/** Resolve lineage at the boundary that already knows the complete quote owner. */
export function useQuoteFeedbackLineage(
  { connectionId, profile, targetProfile, sessionId }: QuoteFeedbackScope,
  storedId: string | null
): void {
  const sessions = useStore($sessions)
  const ownerKey = JSON.stringify([connectionId, profile, targetProfile])
  const previousOwner = useRef(ownerKey)

  // eslint-disable-next-line no-restricted-syntax -- prior owner is a lineage transition guard, not a mirrored atom
  useEffect(() => {
    const sameOwner = previousOwner.current === ownerKey
    previousOwner.current = ownerKey

    // A route/store or owner transition is not proof that two batches belong
    // together, even if another backend happens to reuse these session ids.
    if (sameOwner && storedId && shouldMigrateComposerScope(storedId, sessionId, sessions)) {
      migrateQuoteFeedbackSession({ connectionId, profile, targetProfile, sessionId }, storedId)
    }
  }, [connectionId, ownerKey, profile, sessionId, sessions, storedId, targetProfile])
}
