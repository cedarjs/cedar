/**
 * Thrown when a tenant-owned model is queried with no organization in
 * scope: no `context.currentOrg`, and neither `db.$forOrg(id)` nor
 * `db.$withoutTenant()` was used explicitly. A loud failure here is
 * preferable to a silent cross-tenant read.
 */
export class TenantScopeError extends Error {
  name = 'TenantScopeError'
}
