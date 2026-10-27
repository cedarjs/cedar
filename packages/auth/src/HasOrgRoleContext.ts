import React from 'react'

/**
 * Checks the user's role in the organization they're in, for the components
 * below it: whether it's one of `roles` (a role, or a list of roles). `null`
 * outside an organization, where there's no such role to check.
 *
 * `OrgScope` from `@cedarjs/tenancy/web` provides it, and the router reads
 * it for `<PrivateSet orgRoles>`, which can't depend on the tenancy package.
 */
export const HasOrgRoleContext = React.createContext<
  ((roles: string | string[]) => boolean) | null
>(null)
