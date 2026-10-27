import type { UseAuth } from '@cedarjs/auth'

import { findMembership } from './findMembership.js'
import { getMemberships } from './getMemberships.js'
import { hasOrgRole } from './hasOrgRole.js'

/**
 * Checks the user's role in the organization of the current route, for
 * `<PrivateSet orgRoles>`. Pass it to the router, next to `useAuth`:
 *
 *   <Router useAuth={useAuth} useOrgRoles={useOrgRoles}>
 *
 * The router calls it with its `useAuth` and the current route's path
 * params. It returns `null` when the route has no `orgSlug` param, so there's
 * no organization to check a role in. Otherwise it returns a check of whether
 * the user's role in the organization with that slug is one of `roles` (a
 * role, or a list of roles): `false` when they aren't signed in or aren't a
 * member of it.
 */
export function useOrgRoles(
  useAuth: UseAuth,
  params: Record<string, string>,
): ((roles: string | string[]) => boolean) | null {
  const { isAuthenticated, currentUser } = useAuth()
  const orgSlug = Object.hasOwn(params, 'orgSlug')
    ? params['orgSlug']
    : undefined

  if (orgSlug === undefined) {
    return null
  }

  const memberships = isAuthenticated ? getMemberships(currentUser) : []
  const membership = findMembership(memberships, orgSlug)

  return (roles) =>
    !!membership && hasOrgRole(memberships, roles, membership.organizationId)
}
