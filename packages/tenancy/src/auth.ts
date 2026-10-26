import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { getCurrentOrg, isUserWithMemberships } from './context.js'

type Roles = string | readonly string[]

const toList = (roles: Roles | undefined): string[] =>
  roles === undefined ? [] : typeof roles === 'string' ? [roles] : [...roles]

/**
 * `currentUser.roles` as a list. With tenancy a role belongs to a
 * membership, so most apps leave it empty; it's for roles that hold in
 * every organization, if an app has any.
 */
function userRoles(): string[] {
  const roles = (context.currentUser as { roles?: unknown } | undefined)?.roles

  if (typeof roles === 'string') {
    return [roles]
  }

  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === 'string')
  }

  return []
}

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
 * `true` as long as a matching membership exists.
 */
export function hasOrgRole(roles: Roles, organizationId?: string): boolean {
  const roleList = toList(roles)

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

export interface TenancyAuth {
  /**
   * Whether the signed-in user holds one of `roles` in `currentUser.roles`,
   * as the single-tenant `hasRole()` checked. A user-level check: it never
   * looks at the current organization. False when no one is signed in, and
   * an empty `roles` matches no one. `hasOrgRole()` checks the role in an
   * organization.
   */
  hasRole(roles: Roles): boolean
  /**
   * Guards a service or directive on the current organization: signed in,
   * a member of the current organization and, when `roles` are given, with
   * one of them there. With no `roles`, any member gets in, as any
   * signed-in user gets past the single-tenant `requireAuth()`: use `roles`
   * or `requirePermission()` for anything narrower.
   *
   * Throws `AuthenticationError` when no one is signed in, and
   * `ForbiddenError` otherwise.
   */
  requireOrgAuth(options?: { roles?: Roles }): void
  /**
   * Guards a service or directive on the signed-in user alone, in any
   * organization or none: their account, their memberships, accepting an
   * invitation. When `roles` are given, the user needs one of them in
   * `currentUser.roles`.
   *
   * Throws `AuthenticationError` when no one is signed in, and
   * `ForbiddenError` otherwise.
   */
  requireUserAuth(options?: { roles?: Roles }): void
  /** The standalone `hasOrgRole`: with no roles, any membership */
  hasOrgRole(roles?: Roles, organizationId?: string): boolean
}

/**
 * The auth checks for an app with tenancy, which `api/src/lib/auth.ts`
 * exports in place of its single-tenant `hasRole` and `requireAuth`:
 *
 * ```ts
 * export const { hasRole, hasOrgRole, requireUserAuth, requireOrgAuth } =
 *   createTenancyAuth()
 * ```
 *
 * `hasRole` and `requireUserAuth` are about the signed-in user alone
 * (`currentUser.roles`); `hasOrgRole` and `requireOrgAuth` are about their
 * role in an organization. There's no `requireAuth`: each guard says which
 * it is.
 */
export function createTenancyAuth(): TenancyAuth {
  return {
    hasRole(roles) {
      const roleList = toList(roles)

      return (
        !!context.currentUser &&
        userRoles().some((role) => roleList.includes(role))
      )
    },

    requireUserAuth({ roles } = {}) {
      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      // As the single-tenant `requireAuth`: `roles`, even an empty list,
      // must match
      if (roles && !userRoles().some((role) => toList(roles).includes(role))) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },

    requireOrgAuth({ roles } = {}) {
      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      const currentOrg = getCurrentOrg()

      if (!currentOrg) {
        throw new ForbiddenError(
          'You must be a member of an organization to do that.',
        )
      }

      // As `requireUserAuth`: `roles`, even an empty list, must match
      if (roles && !toList(roles).includes(currentOrg.role)) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },

    hasOrgRole(roles = [], organizationId) {
      return hasOrgRole(roles, organizationId)
    },
  }
}
