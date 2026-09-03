import type { OrgMembership } from './types.js'

/**
 * Type guard for one entry of `currentUser.memberships`, since `currentUser`
 * comes from the app's own `useAuth()` and is typed as `unknown` shape at
 * this boundary.
 */
function isOrgMembership(value: unknown): value is OrgMembership {
  if (!value || typeof value !== 'object') {
    return false
  }

  const membership = value as Record<string, unknown>
  const organization = membership['organization']

  if (!organization || typeof organization !== 'object') {
    return false
  }

  const org = organization as Record<string, unknown>

  return (
    typeof membership['id'] === 'string' &&
    typeof membership['organizationId'] === 'string' &&
    typeof membership['role'] === 'string' &&
    typeof org['id'] === 'string' &&
    typeof org['slug'] === 'string' &&
    typeof org['name'] === 'string'
  )
}

/**
 * Reads `currentUser.memberships` defensively, since `currentUser` is
 * `unknown` shape from the app's `useAuth()`. Returns `[]` when it is
 * missing, not an array, or its entries are not memberships.
 */
export function getMemberships(currentUser: unknown): OrgMembership[] {
  if (!currentUser || typeof currentUser !== 'object') {
    return []
  }

  const memberships = (currentUser as Record<string, unknown>)['memberships']

  if (!Array.isArray(memberships)) {
    return []
  }

  return memberships.filter(isOrgMembership)
}
