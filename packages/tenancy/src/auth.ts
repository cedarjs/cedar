import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { getCurrentOrg, isUserWithMemberships } from './context.js'

/**
 * Whether the current request holds one of `roles` in an organization.
 *
 * With `organizationId`, this checks `context.currentUser.memberships` for a
 * membership in that specific organization — useful for checking access to
 * an organization other than the one in scope. Without it, this checks the
 * role on `context.currentOrg`, the organization already resolved for this
 * request.
 *
 * Returns `false` when there's no authenticated user, no matching
 * organization, or no matching membership. An empty `roles` array returns
 * `true` as long as a matching membership exists, mirroring `hasRole()`'s
 * behavior for global roles.
 */
export function hasOrgRole(
  roles: string | string[],
  organizationId?: string,
): boolean {
  const roleList = Array.isArray(roles) ? roles : [roles]

  if (organizationId) {
    const currentUser = context.currentUser

    if (!isUserWithMemberships(currentUser)) {
      return false
    }

    const membership = currentUser.memberships.find(
      (m) => m.organizationId === organizationId,
    )

    if (!membership) {
      return false
    }

    return roleList.length === 0 || roleList.includes(membership.role)
  }

  const currentOrg = getCurrentOrg()

  if (!currentOrg) {
    return false
  }

  return roleList.length === 0 || roleList.includes(currentOrg.role)
}

/**
 * Guards a service or directive on the current request having a membership
 * in the current organization, optionally with one of `roles`.
 *
 * Throws `AuthenticationError` when there's no authenticated user, and
 * `ForbiddenError` when there's no current organization or the membership's
 * role doesn't match — the same error types `requireAuth` uses, so existing
 * error handling on the web side applies unchanged.
 */
export function requireMembership(
  options: { roles?: string | string[] } = {},
): void {
  if (!context.currentUser) {
    throw new AuthenticationError('You must be logged in to do that.')
  }

  const currentOrg = getCurrentOrg()

  if (!currentOrg) {
    throw new ForbiddenError(
      'You must be a member of an organization to do that.',
    )
  }

  const { roles } = options

  if (roles === undefined) {
    return
  }

  const roleList = Array.isArray(roles) ? roles : [roles]

  if (roleList.length > 0 && !roleList.includes(currentOrg.role)) {
    throw new ForbiddenError('You do not have permission to do that.')
  }
}
