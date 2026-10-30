import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'
import {
  assertPermission,
  assertPermissionDefinitions,
  coversRole,
  permissionsOf as rolePermissions,
} from '@cedarjs/permissions'
import type { PermissionDefinitions } from '@cedarjs/permissions'

import { getCurrentOrg, isUserWithMemberships } from './context.js'

/** What `permissionsOf` needs to know about a membership */
export interface MembershipForPermissions {
  role: string
}

/** A membership as `getCurrentUser` returns it, with its permissions */
export type WithPermissions<
  Membership,
  Permission extends string,
> = Membership & { permissions: Permission[] }

export interface Permissions<Permission extends string> {
  /**
   * Whether the signed-in user may do `permission` in this request: their
   * membership in the current organization has it. False with no current
   * organization.
   */
  hasPermission(permission: Permission): boolean
  /**
   * Guards a service or directive on `hasPermission(permission)`. Throws
   * `AuthenticationError` when no one is signed in, and `ForbiddenError`
   * when they may not.
   */
  requirePermission(permission: Permission): void
  /**
   * Whether the signed-in user may give `role` to someone in the current
   * organization, or take it away: they hold every permission `role` has,
   * so no one can hand out more than they may do themselves. False for a
   * role the definitions don't list.
   *
   * This is only the role half: who may manage members at all is a
   * permission of its own (`members.manage`, say) on the field.
   */
  canGrantRole(role: string): boolean
  /**
   * What a membership may do: its role's permissions. The one place a membership's permissions are worked out, which
   * `hasPermission`, `requirePermission` and `withPermissions` all use.
   */
  permissionsOf(membership: MembershipForPermissions): Permission[]
  /**
   * `user` with each of its memberships' permissions added, for
   * `getCurrentUser` to return, so the web gets them with the memberships
   * (`useAuth().hasPermission`).
   */
  withPermissions<User extends { memberships: MembershipForPermissions[] }>(
    user: User,
  ): Omit<User, 'memberships'> & {
    memberships: WithPermissions<User['memberships'][number], Permission>[]
  }
  withPermissions<User extends { memberships: MembershipForPermissions[] }>(
    user: User | null,
  ):
    | (Omit<User, 'memberships'> & {
        memberships: WithPermissions<User['memberships'][number], Permission>[]
      })
    | null
}

/**
 * Permissions on top of roles: roles map to permissions in one place, and
 * fields and services ask for a permission instead of listing roles, so
 * adding a role is one entry in the definitions instead of an edit to every
 * field it should reach.
 *
 * ```ts
 * // api/src/lib/permissions.ts
 * import { permissions } from '@my-app/permissions'
 *
 * export const { hasPermission, requirePermission, canGrantRole, withPermissions } =
 *   createPermissions(permissions)
 * ```
 *
 * `permissions` comes from `definePermissions`. Fails closed: a role without
 * the permission is refused, as is a role the definitions don't list.
 * Permission names are typed, so a typo in a service is a type error; a
 * name that isn't defined (a typo in an SDL directive) throws instead of
 * quietly refusing everyone.
 */
export function createPermissions<const Permission extends string>(
  definitions: PermissionDefinitions<Permission>,
): Permissions<Permission> {
  assertPermissionDefinitions(definitions)

  const permissionsOf = (membership: MembershipForPermissions) =>
    rolePermissions(definitions, membership.role)

  /**
   * The signed-in user's membership in the current organization, as
   * `getCurrentUser` returned it, so `permissionsOf` sees everything that
   * was loaded with it
   */
  const currentMembership = (): MembershipForPermissions | undefined => {
    const currentOrg = getCurrentOrg()

    if (!currentOrg) {
      return undefined
    }

    const currentUser = context.currentUser
    const membership = isUserWithMemberships(currentUser)
      ? currentUser.memberships.find((m) => m.id === currentOrg.membershipId)
      : undefined

    // `currentOrg.role` is the role this request was resolved with
    return { ...membership, role: currentOrg.role }
  }

  const hasPermission = (permission: Permission): boolean => {
    assertPermission(definitions, permission)

    if (!context.currentUser) {
      return false
    }

    const membership = currentMembership()

    return !!membership && permissionsOf(membership).includes(permission)
  }

  function withPermissions<
    User extends { memberships: MembershipForPermissions[] },
  >(user: User | null) {
    if (!user) {
      return null
    }

    return {
      ...user,
      memberships: user.memberships.map((membership) => ({
        ...membership,
        permissions: permissionsOf(membership),
      })),
    }
  }

  return {
    hasPermission,
    permissionsOf,
    withPermissions,
    canGrantRole(role) {
      const membership = context.currentUser ? currentMembership() : undefined

      return (
        !!membership && coversRole(definitions, permissionsOf(membership), role)
      )
    },
    requirePermission(permission) {
      assertPermission(definitions, permission)

      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      if (!getCurrentOrg()) {
        throw new ForbiddenError(
          'You must be a member of an organization to do that.',
        )
      }

      if (!hasPermission(permission)) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },
  }
}
