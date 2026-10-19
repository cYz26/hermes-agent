import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { migrateQuoteFeedbackSession, quoteFeedbackKey, type QuoteFeedbackScope } from '@/store/quote-feedback'
import { $sessions, shouldMigrateComposerScope } from '@/store/session'

import { QuoteFeedbackContext } from './context'
import { QuoteSelectionToolbar } from './toolbar'

interface QuoteFeedbackProviderProps {
  children: ReactNode
  scope: QuoteFeedbackScope
  enabled?: boolean
  lineageFromSessionId?: null | string
}

/** One capture/feedback scope per chat surface; never resolved from global focus at click time. */
export function QuoteFeedbackProvider({
  children,
  scope,
  enabled = true,
  lineageFromSessionId
}: QuoteFeedbackProviderProps) {
  const root = useRef<HTMLDivElement>(null)
  const key = quoteFeedbackKey(scope)
  const value = useMemo(() => ({ key, root, enabled }), [key, enabled])
  const sessions = useStore($sessions)
  const { connectionId, profile, targetProfile, sessionId } = scope

  useEffect(() => {
    const ownerSessions = sessions.filter(
      session =>
        (!session.connection_id || session.connection_id === connectionId) &&
        (!session.profile || session.profile === profile || session.profile === targetProfile)
    )

    if (lineageFromSessionId && shouldMigrateComposerScope(lineageFromSessionId, sessionId, ownerSessions)) {
      migrateQuoteFeedbackSession({ connectionId, profile, targetProfile, sessionId }, lineageFromSessionId)
    }
  }, [connectionId, lineageFromSessionId, profile, sessionId, sessions, targetProfile])

  return (
    <QuoteFeedbackContext.Provider value={value}>
      <div className="contents" data-slot="quote-feedback-surface" ref={root}>
        {children}
      </div>
      <QuoteSelectionToolbar />
    </QuoteFeedbackContext.Provider>
  )
}
