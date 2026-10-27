import React from 'react'

/**
 * Provides `useAuth().hasPermission` for the components below it. Unset,
 * `hasPermission` is always `false`: permissions belong to a scope, such as
 * an organization, and there is none here.
 *
 * `OrgScope` from `@cedarjs/tenancy/web` provides it, so inside an
 * organization `hasPermission` checks the user's membership there.
 */
export const HasPermissionContext = React.createContext<
  ((permission: string) => boolean) | undefined
>(undefined)
