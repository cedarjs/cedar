import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

type Roles = string | readonly string[]

const toList = (roles: Roles): string[] =>
  typeof roles === 'string' ? [roles] : [...roles]

/**
 * `currentUser.roles` as a list. With tenancy a role belongs to a
 * membership, so most apps leave it empty; it's for roles that hold in
 * every organization, if an app has any.
 */
function currentUserRoles(): string[] {
  const user: unknown = context.currentUser
  const roles =
    typeof user === 'object' && user !== null && 'roles' in user
      ? user.roles
      : undefined

  if (typeof roles === 'string') {
    return [roles]
  }

  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === 'string')
  }

  return []
}

export interface TenancyAuth {
  /**
   * Whether the signed-in user holds one of `roles` in `currentUser.roles`,
   * in any organization or none, as the single-tenant `hasRole()`. A check
   * in the current organization is a permission (`createPermissions`).
   */
  hasRole(roles: Roles): boolean
  /**
   * Guards a service or directive on the signed-in user alone, in any
   * organization or none: their account, their memberships, accepting an
   * invitation. When `roles` are given, the user needs one of them in
   * `currentUser.roles`.
   *
   * Throws `AuthenticationError` when no one is signed in, and
   * `ForbiddenError` otherwise.
   */
  requireAuth(options?: { roles?: Roles }): void
}

/**
 * The auth checks for an app with tenancy, which `api/src/lib/auth.ts`
 * exports in place of its single-tenant `hasRole` and `requireAuth`:
 *
 * ```ts
 * export const { hasRole, requireAuth } = createTenancyAuth()
 * ```
 *
 * Roles are the user's own, in `currentUser.roles`. Checks on the current
 * organization are permissions (`createPermissions`), so a role can do only
 * what its entry in the permission definitions lists.
 */
export function createTenancyAuth(): TenancyAuth {
  return {
    hasRole(roles) {
      const roleList = toList(roles)

      return (
        !!context.currentUser &&
        currentUserRoles().some((role) => roleList.includes(role))
      )
    },

    requireAuth({ roles } = {}) {
      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      // As the single-tenant `requireAuth`: `roles`, even an empty list,
      // must match
      if (
        roles &&
        !currentUserRoles().some((role) => toList(roles).includes(role))
      ) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },
  }
}
