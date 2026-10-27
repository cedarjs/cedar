import React from 'react'

import { ApolloProvider } from '@apollo/client/react'

import type { PermissionName, UseAuth } from '@cedarjs/auth'
import { HasPermissionContext, useNoAuth } from '@cedarjs/auth'
import {
  navigate,
  Redirect,
  routes,
  useLocation,
  useParams,
} from '@cedarjs/router'
import { useCreateApolloClient } from '@cedarjs/web/apollo'

import { findMembership } from './findMembership.js'
import { getMemberships } from './getMemberships.js'
import { hasOrgRole } from './hasOrgRole.js'
import { clearOrgClients, dropOrgClient, getOrgClient } from './orgClients.js'
import { OrgContext } from './OrgContext.js'
import type { CurrentOrgSummary, OrgContextValue } from './types.js'

// Header the API's `resolveCurrentOrg` (from `@cedarjs/tenancy`) reads to
// determine the request's organization.
const CEDAR_ORG_HEADER = 'cedar-org'

export interface OrgScopeProps {
  /** Overrides the `orgSlug` route param. */
  orgSlug?: string
  /** Rendered when the user has no membership matching the slug. */
  notAMember?: React.ReactNode
  /**
   * Only members with one of these roles in the organization get in.
   * Checked after the organization is resolved. For routes, prefer
   * `<PrivateSet orgRoles>`.
   */
  roles?: string | string[]
  /**
   * Only members whose membership has this permission get in (see
   * `createPermissions` in `@cedarjs/tenancy`). Checked like `roles`.
   */
  permission?: PermissionName
  /**
   * The name of the route a member without one of `roles`, or without
   * `permission`, is redirected to. It gets the `orgSlug` param when its
   * path has one, so it can be a page of the same organization. Without
   * it, they get `notAMember`.
   */
  unauthorized?: string
  /**
   * The app's `useAuth`, so `OrgScope` can read `currentUser.memberships`
   * without importing app code. Defaults to `useNoAuth`.
   */
  useAuth?: UseAuth
  /**
   * Called by `useCurrentOrg().setOrg` instead of navigating, for apps that
   * select the organization from state rather than a URL segment.
   */
  onSetOrg?: (idOrSlug: string) => void
  children: React.ReactNode
}

const toList = (roles: string | string[]) =>
  Array.isArray(roles) ? roles : [roles]

const REPLACE = { replace: true }

type NamedRoute = (params?: Record<string, string>) => string

/** Whether `value` is one of `routes`' named route functions */
function isNamedRoute(value: unknown): value is NamedRoute {
  return typeof value === 'function'
}

/**
 * The `unauthorized` route's path: with the organization's `orgSlug` when
 * the route needs one (a page of the same organization), else without.
 */
function unauthorizedPath(route: NamedRoute, orgSlug: string): string {
  try {
    return route()
  } catch (e) {
    if (e instanceof Error && e.message.includes('Missing parameter')) {
      return route({ orgSlug })
    }

    throw e
  }
}

/**
 * Builds `{ organizationId: role }` for every membership, to detect when a
 * memberships refresh drops a membership or changes its role.
 */
function membershipRoleMap(
  memberships: ReturnType<typeof getMemberships>,
): Map<string, string> {
  return new Map(memberships.map((m) => [m.organizationId, m.role]))
}

/**
 * Provides the per-organization Apollo client and `OrgContext` for the
 * organization matching `orgSlug` (a prop, or else the `orgSlug` route
 * param). Renders `notAMember` when the current user has no membership in
 * that organization (or not one with `roles`, see `unauthorized`);
 * otherwise wraps `children` in that organization's own `ApolloProvider`,
 * so every Cell, `useQuery` and `useMutation` under it carries the
 * `cedar-org` header and reads from that organization's cache. Under it,
 * `useAuth().hasPermission` checks the user's membership in that
 * organization.
 */
export function OrgScope({
  orgSlug: orgSlugProp,
  notAMember = null,
  roles,
  permission,
  unauthorized,
  useAuth = useNoAuth,
  onSetOrg,
  children,
}: OrgScopeProps): React.JSX.Element {
  const params = useParams()
  const location = useLocation()
  const createClient = useCreateApolloClient()
  const { isAuthenticated, currentUser } = useAuth()

  const orgSlug = orgSlugProp ?? params['orgSlug']
  const memberships = getMemberships(currentUser)
  // `id` only exists when the app's `getCurrentUser` returns it
  const userId =
    currentUser && 'id' in currentUser && typeof currentUser.id === 'string'
      ? currentUser.id
      : undefined

  const membershipSignature = memberships
    .map((m) => `${m.organizationId}:${m.role}`)
    .sort()
    .join(',')

  // Tracks the user and memberships snapshot the client map was last torn
  // down for, so the effect below only reacts to real changes.
  const lastAuthUserIdRef = React.useRef<string | undefined>(userId)
  const lastMembershipsRef = React.useRef<Map<string, string>>(
    membershipRoleMap(memberships),
  )

  // Bumped whenever the effect below drops a client from the module-level
  // map, so the component re-renders and `getOrgClient` picks up the drop:
  // the render that first observes a role change or a removed membership
  // has already read the (still cached) old client from the map before
  // this effect runs, so dropping it only takes effect from the next
  // render on.
  const [, forceRenderAfterTeardown] = React.useReducer((c) => c + 1, 0)

  React.useEffect(() => {
    const previousUserId = lastAuthUserIdRef.current
    const userChanged =
      previousUserId !== undefined && previousUserId !== userId

    if (!isAuthenticated || userChanged) {
      lastAuthUserIdRef.current = userId
      lastMembershipsRef.current = new Map()
      void clearOrgClients()
      forceRenderAfterTeardown()
      return
    }

    lastAuthUserIdRef.current = userId

    const nextMemberships = membershipRoleMap(memberships)
    let dropped = false

    if (userId) {
      for (const [organizationId, role] of lastMembershipsRef.current) {
        const currentRole = nextMemberships.get(organizationId)

        if (currentRole === undefined || currentRole !== role) {
          void dropOrgClient(userId, organizationId)
          dropped = true
        }
      }
    }

    lastMembershipsRef.current = nextMemberships

    if (dropped) {
      forceRenderAfterTeardown()
    }
    // `membershipSignature` is `memberships` reduced to the values this
    // effect cares about (organization id + role), so it is the only
    // membership-derived dependency needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId, membershipSignature])

  const setOrg = React.useCallback(
    (idOrSlug: string) => {
      if (onSetOrg) {
        onSetOrg(idOrSlug)
        return
      }

      const currentSlug = params['orgSlug']

      if (!currentSlug) {
        throw new Error(
          'useCurrentOrg().setOrg has no orgSlug route param to replace and no onSetOrg prop was given to OrgScope',
        )
      }

      const nextPathname = location.pathname
        .split('/')
        .map((segment) => (segment === currentSlug ? idOrSlug : segment))
        .join('/')

      navigate(nextPathname + location.search + location.hash)
    },
    [onSetOrg, params, location.pathname, location.search, location.hash],
  )

  const membership = findMembership(memberships, orgSlug)

  // `useAuth().hasPermission` below this point: the membership's
  // permissions here
  const membershipPermissions = membership?.permissions
  const hasPermission = React.useCallback(
    (permissionToCheck: string) =>
      membershipPermissions?.includes(permissionToCheck) ?? false,
    [membershipPermissions],
  )

  if (!membership || !userId || !orgSlug) {
    return <>{notAMember}</>
  }

  // The role in this organization, not `currentUser.roles`
  const allowed =
    (roles === undefined || toList(roles).includes(membership.role)) &&
    (permission === undefined || hasPermission(permission))

  if (!allowed) {
    if (!unauthorized) {
      return <>{notAMember}</>
    }

    // `unauthorized` is any string, so look it up rather than index with it.
    // Own properties only, so a name like `toString` isn't a route.
    const route: unknown = Object.hasOwn(routes, unauthorized)
      ? Reflect.get(routes, unauthorized)
      : undefined

    if (!isNamedRoute(route)) {
      throw new Error(`We could not find a route named ${unauthorized}`)
    }

    return <Redirect to={unauthorizedPath(route, orgSlug)} options={REPLACE} />
  }

  const org: CurrentOrgSummary = {
    id: membership.organizationId,
    slug: membership.organization.slug,
    name: membership.organization.name,
    role: membership.role,
    membershipId: membership.id,
    permissions: membership.permissions ?? [],
  }

  const orgClient = getOrgClient({
    userId,
    organizationId: membership.organizationId,
    createClient: () =>
      createClient({
        headers: { [CEDAR_ORG_HEADER]: membership.organizationId },
      }),
  })

  const contextValue: OrgContextValue = {
    org,
    memberships,
    hasOrgRole: (roles, organizationId) =>
      hasOrgRole(memberships, roles, organizationId ?? org.id),
    setOrg,
  }

  return (
    <ApolloProvider client={orgClient}>
      <OrgContext.Provider value={contextValue}>
        <HasPermissionContext.Provider value={hasPermission}>
          {children}
        </HasPermissionContext.Provider>
      </OrgContext.Provider>
    </ApolloProvider>
  )
}
