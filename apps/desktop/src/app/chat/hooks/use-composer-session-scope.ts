import { useCallback, useEffect, useMemo } from 'react'

import { primaryRouteSelectedSessionId } from '@/app/routes'
import { migrateSessionDraft } from '@/store/composer'
import { migrateQueuedPrompts, parkQueuedPrompts } from '@/store/composer-queue'
import { resolveComposerSessionKey, shouldMigrateComposerScope } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

interface ComposerSessionScopeOptions {
  primary: boolean
  pathname: string
  selectedId: string | null
  runtimeId: string | null
  freshDraftKey: string
  sessions: readonly Pick<SessionInfo, '_lineage_root_id' | 'id'>[]
  onCancel: () => Promise<void> | void
}

/** Drafts, queued turns and feedback share the durable conversation identity. */
export function useComposerSessionScope({
  primary, pathname, selectedId, runtimeId, freshDraftKey, sessions, onCancel
}: ComposerSessionScopeOptions) {
  const queueSessionKey = useMemo(() => {
    const selected = primary ? primaryRouteSelectedSessionId(pathname, selectedId) : selectedId

    return resolveComposerSessionKey(selected, sessions)
  }, [primary, pathname, selectedId, sessions])

  useEffect(() => {
    // A route can lead the store during navigation; only lineage rekeys migrate.
    if (!shouldMigrateComposerScope(selectedId, queueSessionKey, sessions)) {
      return
    }

    migrateSessionDraft(selectedId, queueSessionKey)
    migrateQueuedPrompts(selectedId, queueSessionKey)
  }, [queueSessionKey, selectedId, sessions])

  const haltRun = useCallback(() => {
    // Transcript-side Stop parks the queue before interrupting the current turn.
    parkQueuedPrompts(queueSessionKey || runtimeId)

    return onCancel()
  }, [onCancel, queueSessionKey, runtimeId])

  return { queueSessionKey, feedbackSessionKey: queueSessionKey || freshDraftKey, haltRun }
}
