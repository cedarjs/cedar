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
 *
 * An app can pass the router a hook of its own instead, such as one that
 * wraps this one with the organization from somewhere other than the path.
 * Besides returning a check or `null`, it can throw an error of its own,
 * which reaches the app's error boundary like any error thrown while
 * rendering. See `UseOrgRoles` in `@cedarjs/router`.
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
