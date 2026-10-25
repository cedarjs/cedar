import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { getCurrentOrg } from './context.js'

type RolePermissions = Record<string, readonly string[]>

export interface PermissionsConfig<
  Roles extends RolePermissions,
  UserPermissions extends readonly string[],
> {
  /**
   * What each role may do in an organization: the permissions a membership
   * with that role has there. A role that isn't listed has none.
   */
  roles: Roles
  /**
   * What every signed-in user may do, in any organization or none: things
   * about their own account. No organization is needed for these.
   */
  user?: UserPermissions
}

/** A membership as `getCurrentUser` returns it, with its permissions */
export type WithPermissions<
  Membership,
  Permission extends string,
> = Membership & { permissions: Permission[] }

export interface Permissions<Permission extends string> {
  /**
   * Whether the signed-in user may do `permission` in this request: a user
   * permission needs only a signed-in user; any other needs a current
   * organization whose membership's role has it.
   */
  can(permission: Permission): boolean
  /**
   * Guards a service or directive on `can(permission)`. Throws
   * `AuthenticationError` when no one is signed in, and `ForbiddenError`
   * when they may not.
   */
  requirePermission(options: { permission: Permission }): void
  /** The permissions a membership with `role` has: its role's, and the user's */
  permissionsOf(role: string): Permission[]
  /**
   * `user` with each of its memberships' permissions added, for
   * `getCurrentUser` to return, so the web knows them without a copy of
   * this map (`useCurrentOrg().can`).
   */
  withPermissions<User extends { memberships: { role: string }[] }>(
    user: User,
  ): Omit<User, 'memberships'> & {
    memberships: WithPermissions<User['memberships'][number], Permission>[]
  }
  withPermissions<User extends { memberships: { role: string }[] }>(
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
 * adding a role is one entry here instead of an edit to every field it
 * should reach.
 *
 * ```ts
 * // api/src/lib/permissions.ts
 * export const { can, requirePermission, withPermissions } =
 *   createPermissions({
 *     roles: {
 *       owner: ['projects.read', 'projects.edit', 'members.manage'],
 *       admin: ['projects.read', 'projects.edit', 'members.manage'],
 *       member: ['projects.read'],
 *     },
 *     user: ['account.manage'],
 *   })
 * ```
 *
 * Fails closed: a role without the permission is refused, as is a role
 * that isn't in the map. Permission names are typed from the map, so a
 * typo in a service is a type error; a name the map doesn't know (a typo
 * in an SDL directive) throws instead of quietly refusing everyone.
 */
export function createPermissions<
  const Roles extends RolePermissions,
  const UserPermissions extends readonly string[] = readonly [],
>(
  config: PermissionsConfig<Roles, UserPermissions>,
): Permissions<Roles[keyof Roles][number] | UserPermissions[number]> {
  type Permission = Roles[keyof Roles][number] | UserPermissions[number]

  const userPermissions = [...(config.user ?? [])] as Permission[]
  const known = new Set<string>([
    ...userPermissions,
    ...Object.values(config.roles).flat(),
  ])

  const rolePermissions = (role: string): Permission[] =>
    Object.hasOwn(config.roles, role)
      ? ([...config.roles[role]] as Permission[])
      : []

  const assertKnown = (permission: string) => {
    if (!known.has(permission)) {
      throw new Error(
        `Unknown permission "${permission}". Add it to the permissions map ` +
          '(createPermissions) before using it.',
      )
    }
  }

  const can = (permission: Permission): boolean => {
    assertKnown(permission)

    if (!context.currentUser) {
      return false
    }

    if (userPermissions.includes(permission)) {
      return true
    }

    const currentOrg = getCurrentOrg()

    return !!currentOrg && rolePermissions(currentOrg.role).includes(permission)
  }

  const permissionsOf = (role: string): Permission[] => [
    ...new Set([...rolePermissions(role), ...userPermissions]),
  ]

  function withPermissions<User extends { memberships: { role: string }[] }>(
    user: User | null,
  ) {
    if (!user) {
      return null
    }

    return {
      ...user,
      memberships: user.memberships.map((membership) => ({
        ...membership,
        permissions: permissionsOf(membership.role),
      })),
    }
  }

  return {
    can,
    permissionsOf,
    withPermissions,
    requirePermission({ permission }) {
      assertKnown(permission)

      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      if (!userPermissions.includes(permission) && !getCurrentOrg()) {
        throw new ForbiddenError(
          'You must be a member of an organization to do that.',
        )
      }

      if (!can(permission)) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },
  }
}
