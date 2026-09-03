/**
 * One of the current user's memberships, as `getCurrentUser()` returns them
 * on the API side (see the plan's "Web entry" section): a snapshot taken at
 * authentication, refreshed by `reauthenticate()`.
 */
export interface OrgMembership {
  id: string
  organizationId: string
  role: string
  organization: {
    id: string
    slug: string
    name: string
  }
}

/**
 * The organization `OrgScope` has resolved for the current route, combining
 * the matching membership with the organization it belongs to.
 */
export interface CurrentOrgSummary {
  id: string
  slug: string
  name: string
  role: string
  membershipId: string
}

/**
 * The value `OrgContext` carries, read through `useCurrentOrg()`.
 */
export interface OrgContextValue {
  org: CurrentOrgSummary | undefined
  memberships: OrgMembership[]
  hasOrgRole(roles: string | string[], organizationId?: string): boolean
  setOrg(idOrSlug: string): void
}
