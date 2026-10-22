import type { QuoteFeedbackScope } from '@/store/quote-feedback'
import type { SessionOwnerRoute } from '@/store/session-request-router'

import type { ComposerScope } from '../composer/scope'

interface FeedbackScopeOptions {
  activeProfile: string
  connectionId: string
  composer: Pick<ComposerScope, 'connectionId' | 'profile' | 'ownerRoute'>
  owner?: SessionOwnerRoute
  feedbackSessionKey?: string | null
  storedId: string | null
}

/** Resolve only this surface's captured identities, never later global focus. */
export function resolveQuoteFeedbackScope({
  activeProfile, connectionId, composer, owner, feedbackSessionKey, storedId
}: FeedbackScopeOptions): QuoteFeedbackScope {
  const ownerProfile = owner?.targetProfile || owner?.profile
  const captured = composer.ownerRoute

  return {
    connectionId: captured?.connectionId ?? composer.connectionId ?? owner?.connectionId ?? (connectionId || null),
    profile: captured?.profile ?? owner?.profile ?? composer.profile ?? activeProfile,
    targetProfile: captured ? captured.targetProfile || captured.profile : composer.profile ?? ownerProfile ?? activeProfile,
    sessionId: feedbackSessionKey ?? storedId ?? 'new'
  }
}
