import type { OrgMembership } from './types.js'

/**
 * The membership in the organization whose slug is `orgSlug`, if the user
 * has one. `OrgScope` and `useOrgRoles` both find the organization with it,
 * so they agree on which one a route is in.
 */
export function findMembership(
  memberships: OrgMembership[],
  orgSlug: string | undefined,
): OrgMembership | undefined {
  if (!orgSlug) {
    return undefined
  }

  return memberships.find((m) => m.organization.slug === orgSlug)
}
