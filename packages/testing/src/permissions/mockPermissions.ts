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
 * of its own keeps them, and without definitions `user` is as it was.
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

  return { ...user, permissions: permissionsOf(definitions, roleList) }
}
