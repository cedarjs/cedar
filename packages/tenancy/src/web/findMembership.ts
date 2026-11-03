import type { OrgMembership } from './types.js'

/**
 * The membership in the organization whose slug is `orgSlug`, if the user
 * has one. The default `useOrg` of `createTenancy` finds the organization
 * with it.
 */
export function findMembership(
  memberships: readonly OrgMembership[],
  orgSlug: string | undefined,
): OrgMembership | undefined {
  if (!orgSlug) {
    return undefined
  }

  return memberships.find((m) => m.organization.slug === orgSlug)
}
