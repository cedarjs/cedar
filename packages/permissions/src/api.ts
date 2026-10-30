import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import {
  assertPermission,
  assertPermissionDefinitions,
  coversRole,
  permissionsOf,
} from './definePermissions.js'
import type { PermissionDefinitions } from './definePermissions.js'

/** A user as `getCurrentUser` returns it, with its permissions */
export type WithPermissions<User, Permission extends string> = User & {
  permissions: Permission[]
}

export interface Permissions<Permission extends string> {
  /**
   * Whether the signed-in user may do `permission`: one of their roles,
   * in `currentUser.roles`, has it. False when no one is signed in.
   */
  hasPermission(permission: Permission): boolean
  /**
   * Guards a service or directive on `hasPermission(permission)`. Throws
   * `AuthenticationError` when no one is signed in, and `ForbiddenError`
   * when they may not.
   */
  requirePermission(permission: Permission): void
  /**
   * Whether the signed-in user may give `role` to someone, or take it
   * away: they hold every permission `role` has, so no one can hand out
   * more than they may do themselves. False for a role the definitions
   * don't list.
   *
   * This is only the role half: who may manage users at all is a
   * permission of its own (`users.manage`, say) on the field.
   */
  canGrantRole(role: string): boolean
  /**
   * What `user` may do: the permissions of each of its roles, from
   * `user.roles` (one role, or a list of them). The one place a user's
   * permissions are worked out, which `hasPermission`, `requirePermission`
   * and `withPermissions` all use.
   */
  permissionsOf(user: unknown): Permission[]
  /**
   * `user` with its permissions added, for `getCurrentUser` to return, so
   * the web gets them (`useAuth().hasPermission`)
   */
  withPermissions<User extends object>(
    user: User,
  ): WithPermissions<User, Permission>
  withPermissions<User extends object>(
    user: User | null,
  ): WithPermissions<User, Permission> | null
}

/** `user.roles` as a list, for one role or a list of them */
function rolesOf(user: unknown): string[] {
  if (typeof user !== 'object' || user === null || !('roles' in user)) {
    return []
  }

  const { roles } = user

  if (typeof roles === 'string') {
    return [roles]
  }

  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : []
}

/**
 * Permissions on top of the user's roles: roles map to permissions in one
 * place, and fields and services ask for a permission instead of listing
 * roles, so adding a role is one entry in the definitions instead of an
 * edit to every field it should reach.
 *
 * ```ts
 * // api/src/lib/permissions.ts
 * import { permissions } from '@my-app/permissions'
 *
 * export const { hasPermission, requirePermission, canGrantRole, withPermissions } =
 *   createPermissions(permissions)
 * ```
 *
 * `permissions` comes from `definePermissions`. A user's permissions are
 * those of their roles, in `currentUser.roles`. Fails closed: a user whose
 * roles don't have the permission is refused, as is a role the definitions
 * don't list. Permission names are typed, so a typo in a service is a type
 * error; a name that isn't defined (a typo in an SDL directive) throws
 * instead of quietly refusing everyone.
 */
export function createPermissions<const Permission extends string>(
  definitions: PermissionDefinitions<Permission>,
): Permissions<Permission> {
  assertPermissionDefinitions(definitions)

  const userPermissions = (user: unknown) =>
    permissionsOf(definitions, rolesOf(user))

  const hasPermission = (permission: Permission): boolean => {
    assertPermission(definitions, permission)

    // From the roles, not `currentUser.permissions`, so a user returned
    // without `withPermissions` is checked the same way
    return userPermissions(context.currentUser).includes(permission)
  }

  function withPermissions<User extends object>(user: User | null) {
    if (!user) {
      return null
    }

    return { ...user, permissions: userPermissions(user) }
  }

  return {
    hasPermission,
    permissionsOf: userPermissions,
    withPermissions,
    canGrantRole(role) {
      if (!context.currentUser) {
        return false
      }

      return coversRole(definitions, userPermissions(context.currentUser), role)
    },
    requirePermission(permission) {
      assertPermission(definitions, permission)

      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      if (!hasPermission(permission)) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },
  }
}
