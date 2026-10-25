import { context } from '@cedarjs/context'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { getCurrentOrg, isUserWithMemberships } from './context.js'

type Roles = string | readonly string[]

const toList = (roles: Roles | undefined): string[] =>
  roles === undefined ? [] : typeof roles === 'string' ? [roles] : [...roles]

/**
 * What a `requireAuth` check is about.
 *
 * - `'ORGANIZATION'` (the default): the current organization. A current
 *   organization is required, and roles are the user's membership's role in
 *   it.
 * - `'USER'`: the signed-in user themselves, in whichever organization or
 *   none: their account, their memberships, accepting an invitation. Roles
 *   are `currentUser.roles`.
 *
 * Upper case so the `@requireAuth(scope: USER)` directive's enum value can
 * be passed straight through.
 */
export type AuthScope = 'ORGANIZATION' | 'USER'

/**
 * `currentUser.roles` as a list. With tenancy a role belongs to a
 * membership, so most apps leave it empty; it's for roles that hold in
 * every organization, if an app has any.
 */
function userRoles(): string[] {
  const roles = (context.currentUser as { roles?: unknown } | undefined)?.roles

  if (typeof roles === 'string') {
    return [roles]
  }

  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === 'string')
  }

  return []
}

/**
 * The current user's roles for this request: inside an organization (a
 * `currentOrg` is set), their membership's role there; outside one,
 * `currentUser.roles`. One resolver, so `hasRole()` and `requireAuth()`
 * answer per organization.
 *
 * Empty when no one is signed in.
 */
export function getCurrentRoles(): string[] {
  if (!context.currentUser) {
    return []
  }

  const currentOrg = getCurrentOrg()

  return currentOrg ? [currentOrg.role] : userRoles()
}

/**
 * Whether the current request holds one of `roles` in an organization.
 *
 * With `organizationId`, this checks `context.currentUser.memberships` for a
 * membership in that specific organization — useful for checking access to
 * an organization other than the one in scope. Without it, this checks the
 * role on `context.currentOrg`, the organization already resolved for this
 * request.
 *
 * Returns `false` when there's no authenticated user, no matching
 * organization, or no matching membership. An empty `roles` array returns
 * `true` as long as a matching membership exists, mirroring `hasRole()`'s
 * behavior for global roles. The `hasOrgRole` from
 * `createTenancyAuth({ defaultRoles })` admits `defaultRoles` instead.
 */
export function hasOrgRole(roles: Roles, organizationId?: string): boolean {
  const roleList = toList(roles)

  if (organizationId) {
    const currentUser = context.currentUser

    if (!isUserWithMemberships(currentUser)) {
      return false
    }

    const membership = currentUser.memberships.find(
      (m) => m.organizationId === organizationId,
    )

    if (!membership) {
      return false
    }

    return roleList.length === 0 || roleList.includes(membership.role)
  }

  const currentOrg = getCurrentOrg()

  if (!currentOrg) {
    return false
  }

  return roleList.length === 0 || roleList.includes(currentOrg.role)
}

export interface TenancyAuthOptions {
  /**
   * The roles an organization check admits when it lists none: a bare
   * `@requireAuth`, `requireAuth()`, and `hasOrgRole()` without roles.
   * Unset, any membership is enough.
   *
   * Set it to the roles that may use everything (`cedar setup tenancy`
   * sets the roles it generates), and a role added later is refused
   * everywhere until a field lets it in by listing it. Without it, a new,
   * narrower role can use every field that doesn't list roles, including
   * the ones added after it.
   */
  defaultRoles?: readonly string[]
}

export interface TenancyAuth {
  /**
   * Whether the signed-in user holds one of `roles` for this request: their
   * role in the current organization, or `currentUser.roles` outside one
   * (`getCurrentRoles()`).
   */
  hasRole(roles: Roles): boolean
  /**
   * Guards a service or directive. By default (`scope: 'ORGANIZATION'`):
   * signed in, a member of the current organization, and with one of
   * `roles` there, or of `defaultRoles` when none are given. With
   * `scope: 'USER'`: signed in, and, when `roles` are given, with one of
   * them in `currentUser.roles`.
   *
   * Throws `AuthenticationError` when no one is signed in, and
   * `ForbiddenError` otherwise.
   */
  requireAuth(options?: { roles?: Roles; scope?: AuthScope }): void
  /** `hasOrgRole`, admitting `defaultRoles` when given no roles */
  hasOrgRole(roles?: Roles, organizationId?: string): boolean
}

/**
 * The auth checks for an app with tenancy, which `api/src/lib/auth.ts`
 * exports in place of its single-tenant `hasRole` and `requireAuth`:
 *
 * ```ts
 * export const { hasRole, requireAuth, hasOrgRole } = createTenancyAuth({
 *   defaultRoles: ['owner', 'admin', 'member'],
 * })
 * ```
 *
 * `requireAuth` is about the current organization unless told otherwise,
 * so forgetting `scope: 'USER'` on a user-level field fails closed (the
 * field needs an organization) rather than open.
 */
export function createTenancyAuth(
  options: TenancyAuthOptions = {},
): TenancyAuth {
  const defaultRoles = [...(options.defaultRoles ?? [])]

  const orDefault = (roles: Roles | undefined) => {
    const roleList = toList(roles)
    return roleList.length > 0 ? roleList : defaultRoles
  }

  return {
    hasRole(roles) {
      const roleList = toList(roles)
      return getCurrentRoles().some((role) => roleList.includes(role))
    },

    requireAuth({ roles, scope = 'ORGANIZATION' } = {}) {
      if (!context.currentUser) {
        throw new AuthenticationError("You don't have permission to do that.")
      }

      if (scope === 'USER') {
        const roleList = toList(roles)

        if (
          roleList.length > 0 &&
          !userRoles().some((role) => roleList.includes(role))
        ) {
          throw new ForbiddenError("You don't have access to do that.")
        }

        return
      }

      const currentOrg = getCurrentOrg()

      if (!currentOrg) {
        throw new ForbiddenError(
          'You must be a member of an organization to do that.',
        )
      }

      const admitted = orDefault(roles)

      if (admitted.length > 0 && !admitted.includes(currentOrg.role)) {
        throw new ForbiddenError("You don't have access to do that.")
      }
    },

    hasOrgRole(roles, organizationId) {
      return hasOrgRole(orDefault(roles), organizationId)
    },
  }
}
