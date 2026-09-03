import React from 'react'

import { ApolloProvider } from '@apollo/client/react'

import type { UseAuth } from '@cedarjs/auth'
import { useNoAuth } from '@cedarjs/auth'
import { navigate, useLocation, useParams } from '@cedarjs/router'
import { useCreateApolloClient } from '@cedarjs/web/apollo'

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
 * that organization; otherwise wraps `children` in that organization's own
 * `ApolloProvider`, so every Cell, `useQuery` and `useMutation` under it
 * carries the `cedar-org` header and reads from that organization's cache.
 */
export function OrgScope({
  orgSlug: orgSlugProp,
  notAMember = null,
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
  const userId =
    typeof currentUser?.['id'] === 'string' ? currentUser['id'] : undefined

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

  const membership = orgSlug
    ? memberships.find((m) => m.organization.slug === orgSlug)
    : undefined

  if (!membership || !userId) {
    return <>{notAMember}</>
  }

  const org: CurrentOrgSummary = {
    id: membership.organizationId,
    slug: membership.organization.slug,
    name: membership.organization.name,
    role: membership.role,
    membershipId: membership.id,
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
      <OrgContext.Provider value={contextValue}>{children}</OrgContext.Provider>
    </ApolloProvider>
  )
}
