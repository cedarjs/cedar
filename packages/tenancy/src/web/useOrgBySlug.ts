import type { RouterOrg, UseOrg } from '@cedarjs/router'

import { findMembership } from './findMembership.js'
import { getMemberships } from './getMemberships.js'
import type { OrgMembership } from './types.js'

/** What `useOrgBySlug` finds: the router's organization, with full memberships */
export interface OrgBySlug extends RouterOrg {
  membership: OrgMembership | null
  memberships: OrgMembership[]
}

/**
 * Finds the organization with the slug `orgSlug` in the signed-in user's
 * `currentUser.memberships`, for a `useOrg` of `createTenancy`. It is what
 * `createTenancy` uses by default, with the route's `orgSlug` param.
 *
 * Returns `null` when `orgSlug` is `undefined`, so there's no organization.
 * Otherwise the `membership` is `null` when the user isn't signed in or isn't
 * a member of that organization.
 *
 * A hook: it reads the user with the router's `useAuth`.
 */
export function useOrgBySlug(
  useAuth: Parameters<UseOrg>[0],
  orgSlug: string | undefined,
): OrgBySlug | null {
  const { isAuthenticated, currentUser } = useAuth()

  if (orgSlug === undefined) {
    return null
  }

  const memberships = isAuthenticated ? getMemberships(currentUser) : []

  return {
    membership: findMembership(memberships, orgSlug) ?? null,
    memberships,
  }
}
