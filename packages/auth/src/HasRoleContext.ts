import React from 'react'

/**
 * Overrides `useAuth().hasRole` for the components below it. Unset, `hasRole`
 * checks `currentUser.roles`.
 *
 * For roles that depend on where in the app you are rather than on the user
 * alone: `OrgScope` from `@cedarjs/tenancy/web` provides it, so inside an
 * organization `hasRole` checks the user's role in that organization. That
 * includes a `<PrivateSet roles>` nested inside it, which reads `hasRole`
 * through the router's `useAuth`.
 */
export const HasRoleContext = React.createContext<
  ((rolesToCheck: string | string[]) => boolean) | undefined
>(undefined)
