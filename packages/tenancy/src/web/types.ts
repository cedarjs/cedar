/**
 * One of the current user's memberships, as `getCurrentUser()` returns them
 * on the API side (see the plan's "Web entry" section): a snapshot taken at
 * authentication, refreshed by `reauthenticate()`.
 */
export interface OrgMembership {
  id: string
  organizationId: string
  role: string
  /**
   * What the membership may do: `withPermissions` from the app's
   * permissions map adds these in `getCurrentUser`. Missing when the app
   * doesn't use permissions.
   */
  permissions?: string[]
  organization: {
    id: string
    slug: string
    name: string
  }
}

/**
 * The organization the router has resolved for the current route, combining
 * the matching membership with the organization it belongs to.
 */
export interface CurrentOrgSummary {
  id: string
  slug: string
  name: string
  role: string
  membershipId: string
  /** The membership's permissions; empty when the app doesn't use them */
  permissions: string[]
}

/**
 * What the organization provider provides below it, read through `useCurrentOrg()`.
 */
export interface OrgContextValue {
  org: CurrentOrgSummary | undefined
  memberships: OrgMembership[]
  hasOrgRole(roles: string | string[], organizationId?: string): boolean
  setOrg(idOrSlug: string): void
}
