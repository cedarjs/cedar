import type { CurrentUser } from './AuthContext.js'

/**
 * Whether `currentUser.permissions` has `permission`. `getCurrentUser` adds
 * them with `withPermissions` in an app that has run
 * `cedar setup permissions`: the permissions of the user's roles. With
 * tenancy, permissions belong to a membership instead, so `currentUser`
 * has none of its own.
 */
export function currentUserHasPermission(
  currentUser: CurrentUser,
  permission: string,
): boolean {
  // `permissions` only exists when the app's `getCurrentUser` returns it
  const permissions =
    currentUser && 'permissions' in currentUser
      ? currentUser.permissions
      : undefined

  return Array.isArray(permissions) && permissions.includes(permission)
}
