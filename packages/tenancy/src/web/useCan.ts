import React from 'react'

import { OrgContext } from './OrgContext.js'

/**
 * Whether the signed-in user's membership in the current organization has
 * `permission` (from the app's permissions map, which `getCurrentUser`
 * adds to each membership with `withPermissions`). False outside an
 * `OrgScope`, so a check in the wrong place hides rather than shows.
 *
 * This only decides what to show; the api's `@requirePermission` is the
 * guard.
 */
export function useCan(permission: string): boolean {
  const context = React.useContext(OrgContext)

  return context?.can(permission) ?? false
}
