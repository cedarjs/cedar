import React from 'react'

/**
 * Provides `useAuth().hasPermission` for the components below it, for a
 * scope with permissions of its own. Unset, `hasPermission` checks
 * `currentUser.permissions`, the user's own (`cedar setup permissions`).
 *
 * The organization provider that the `Router` renders for `tenancy` from
 * `@cedarjs/tenancy/web` provides it, so inside an organization route
 * `hasPermission` checks the user's membership there. With tenancy,
 * `currentUser` has no permissions of its own, so outside an organization
 * `hasPermission` is `false`.
 */
export const HasPermissionContext = React.createContext<
  ((permission: string) => boolean) | undefined
>(undefined)
