import type { OrgMembership } from './types.js'

/**
 * Pure role check over a memberships snapshot, with no dependency on auth or
 * context. `useCurrentOrg().hasOrgRole` and the app's own code (checking a
 * membership other than the current organization's) both build on this.
 *
 * Returns `false` when there is no membership in `organizationId`. An empty
 * `roles` list returns `true` when a membership exists, matching
 * `@cedarjs/tenancy`'s server-side `hasOrgRole`.
 */
export function hasOrgRole(
  memberships: OrgMembership[] | undefined,
  roles: string | string[],
  organizationId: string,
): boolean {
  const membership = memberships?.find(
    (candidate) => candidate.organizationId === organizationId,
  )

  if (!membership) {
    return false
  }

  const roleList = Array.isArray(roles) ? roles : [roles]

  if (roleList.length === 0) {
    return true
  }

  return roleList.includes(membership.role)
}
