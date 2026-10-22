import { normalizeProfileKey } from './profile'
import type { SessionProfileRoute } from './session-request-router'

/** A local rename cannot change an identically named remote owner. */
export function renameLocalSessionOwner(
  owner: SessionProfileRoute | undefined,
  from: string,
  to: string
): SessionProfileRoute | undefined {
  if (!owner || (String(owner.connectionId ?? '').trim() || 'local') !== 'local') {
    return owner
  }

  const profile = normalizeProfileKey(owner.profile) === from ? to : owner.profile
  const targetProfile = normalizeProfileKey(owner.targetProfile) === from ? to : owner.targetProfile

  return profile === owner.profile && targetProfile === owner.targetProfile
    ? owner
    : { ...owner, profile, ...(targetProfile === undefined ? {} : { targetProfile }) }
}
