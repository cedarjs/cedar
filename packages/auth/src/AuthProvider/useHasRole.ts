import { useCallback } from 'react'

import type { CurrentUser } from '../AuthContext.js'

export const useHasRole = (currentUser: CurrentUser) => {
  /**
   * @example
   * ```js
   *  hasRole("editor")
   *  hasRole(["editor"])
   *  hasRole(["editor", "author"])
   * ```
   *
   * Checks if the "currentUser" from the api side
   * is assigned a role or one of a list of roles.
   * If the user is assigned any of the provided list of roles,
   * the hasRole is considered to be true.
   */
  return useCallback(
    (rolesToCheck: string | string[]): boolean => {
      // `roles` only exists when the app's `getCurrentUser` returns it, so
      // check for it before reading it. `CurrentUser` also accepts primitives
      // (e.g. a string), and `in` throws on anything that isn't an object, so
      // check `typeof` first.
      const roles =
        currentUser && typeof currentUser === 'object' && 'roles' in currentUser
          ? currentUser.roles
          : undefined

      if (roles) {
        if (typeof rolesToCheck === 'string') {
          if (typeof roles === 'string') {
            // rolesToCheck is a string, roles is a string
            return roles === rolesToCheck
          } else if (Array.isArray(roles)) {
            // rolesToCheck is a string, roles is an array
            return roles.some((allowedRole) => rolesToCheck === allowedRole)
          }
        }

        if (Array.isArray(rolesToCheck)) {
          if (Array.isArray(roles)) {
            // rolesToCheck is an array, roles is an array
            return roles.some((allowedRole) =>
              rolesToCheck.includes(allowedRole),
            )
          } else if (typeof roles === 'string') {
            // rolesToCheck is an array, roles is a string
            return rolesToCheck.some((allowedRole) => roles === allowedRole)
          }
        }
      }

      return false
    },
    [currentUser],
  )
}
