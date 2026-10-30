import { permissionsOf } from '@cedarjs/permissions'
import type { PermissionDefinitions } from '@cedarjs/permissions'

/**
 * The app's permission definitions, which the test setup loads in an app
 * that has run `cedar setup permissions` (see `loadAppPermissions`)
 */
let definitions: PermissionDefinitions | undefined

export function setMockPermissionDefinitions(
  appDefinitions: PermissionDefinitions | undefined,
) {
  definitions = appDefinitions
}

/**
 * `user` with the `permissions` the app's definitions give its `roles`, as
 * `withPermissions` adds them in `getCurrentUser`. A user with permissions
 * of its own keeps them.
 */
export function withMockPermissions<User>(user: User): User {
  if (
    !definitions ||
    typeof user !== 'object' ||
    user === null ||
    'permissions' in user ||
    !('roles' in user)
  ) {
    return user
  }

  const { roles } = user
  const roleList =
    typeof roles === 'string'
      ? [roles]
      : Array.isArray(roles)
        ? roles.filter((role): role is string => typeof role === 'string')
        : []

  const permissions = permissionsOf(definitions, roleList)

  // A user whose roles have no permissions is left as the test wrote it, so
  // a test comparing the mocked user to what it passed in still matches
  return permissions.length > 0 ? { ...user, permissions } : user
}
