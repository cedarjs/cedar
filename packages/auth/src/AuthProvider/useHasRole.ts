import { useCallback } from 'react'

import type { CurrentUser } from '../AuthContext.js'
import { currentUserHasRole } from '../currentUserHasRole.js'

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
    (rolesToCheck: string | string[]): boolean =>
      currentUserHasRole(currentUser, rolesToCheck),
    [currentUser],
  )
}
