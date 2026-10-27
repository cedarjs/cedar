import React from 'react'

import { ApolloProvider } from '@apollo/client/react'

import { HasPermissionContext } from '@cedarjs/auth'
import { navigate, useLocation, useParams } from '@cedarjs/router'
import type { OrgProviderProps, Tenancy, UseOrg } from '@cedarjs/router'
import { useCreateApolloClient } from '@cedarjs/web/apollo'

import { isOrgMembership } from './getMemberships.js'
import { hasOrgRole } from './hasOrgRole.js'
import { getOrgClient } from './orgClients.js'
import { OrgContext } from './OrgContext.js'
import type { CurrentOrgSummary, OrgContextValue } from './types.js'
import { useOrgBySlug } from './useOrgBySlug.js'
import { getUserId, useOrgClientTeardown } from './useOrgClientTeardown.js'

// Header the API's `resolveCurrentOrg` (from `@cedarjs/tenancy`) reads to
// determine the request's organization.
const CEDAR_ORG_HEADER = 'cedar-org'

export interface CreateTenancyOptions {
  /**
   * Finds the organization of a route, given the router's `useAuth` and the
   * route's path params: `null` when the route isn't in an organization.
   * By default it is the one with the route's `orgSlug` param (see
   * `useOrgBySlug`). Use it for an organization that doesn't come from the
   * path, such as from the host:
   *
   *   createTenancy({
   *     useOrg: (useAuth) => useOrgBySlug(useAuth, subdomain()),
   *   })
   *
   * It's a hook: the router calls it on every render of a private set.
   */
  useOrg?: UseOrg
  /** Rendered for a signed-in user who isn't a member of the organization */
  notAMember?: React.ReactNode
  /**
   * Called by `useCurrentOrg().setOrg` instead of navigating, for apps that
   * select the organization from state rather than a URL segment.
   */
  onSetOrg?: (idOrSlug: string) => void
}

interface OrgProviderImplementationProps extends OrgProviderProps {
  notAMember: React.ReactNode
  onSetOrg: ((idOrSlug: string) => void) | undefined
}

/**
 * Provides the per-organization Apollo client and `OrgContext` for the
 * organization the router found for the route. Wraps `children` in that
 * organization's own `ApolloProvider`, so every Cell, `useQuery` and
 * `useMutation` under it carries the `cedar-org` header and reads from that
 * organization's cache. Under it, `useAuth().hasPermission` checks the
 * user's membership in that organization.
 */
function OrgProviderImplementation({
  useAuth,
  membership: routerMembership,
  memberships: routerMemberships,
  notAMember,
  onSetOrg,
  children,
}: OrgProviderImplementationProps): React.JSX.Element {
  const params = useParams()
  const location = useLocation()
  const createClient = useCreateApolloClient()
  const { currentUser } = useAuth()
  const userId = getUserId(currentUser)

  const membership = isOrgMembership(routerMembership)
    ? routerMembership
    : undefined
  const memberships = routerMemberships.filter(isOrgMembership)

  const setOrg = React.useCallback(
    (idOrSlug: string) => {
      if (onSetOrg) {
        onSetOrg(idOrSlug)
        return
      }

      const currentSlug = params['orgSlug']

      if (!currentSlug) {
        throw new Error(
          'useCurrentOrg().setOrg has no orgSlug route param to replace and no onSetOrg option was given to createTenancy',
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

  // `useAuth().hasPermission` below this point: the membership's
  // permissions here
  const membershipPermissions = membership?.permissions
  const hasPermission = React.useCallback(
    (permissionToCheck: string) =>
      membershipPermissions?.includes(permissionToCheck) ?? false,
    [membershipPermissions],
  )

  // The client is keyed by user, so without an id there's nothing to key it
  // by
  if (!membership || !userId) {
    return <>{notAMember}</>
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
    role: membership.role,
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

/** The organization with the route's `orgSlug` param */
const useOrgFromParams: UseOrg = (useAuth, params) =>
  useOrgBySlug(
    useAuth,
    Object.hasOwn(params, 'orgSlug') ? params['orgSlug'] : undefined,
  )

/**
 * Makes the `tenancy` to pass to the `Router`. The router then renders the
 * organization's provider itself, around the layouts and page of every
 * `PrivateSet` whose route is in an organization (by default, one with
 * `{orgSlug}` in its path), and checks `orgRoles` and `orgPermission` on
 * those sets.
 *
 * Call it once, at the top level of a module, like `web/src/tenancy.tsx`:
 * a new tenancy on each render would remount the provider.
 *
 *   export const tenancy = createTenancy({
 *     notAMember: <p>You don't have access to this organization.</p>,
 *   })
 *
 *   <Router useAuth={useAuth} tenancy={tenancy}>
 */
export function createTenancy(options: CreateTenancyOptions = {}): Tenancy {
  const {
    useOrg: useFindOrg = useOrgFromParams,
    notAMember,
    onSetOrg,
  } = options

  const useOrg: UseOrg = (useAuth, params) => {
    useOrgClientTeardown(useAuth)

    return useFindOrg(useAuth, params)
  }

  const OrgProvider = (props: OrgProviderProps) => (
    <OrgProviderImplementation
      {...props}
      notAMember={notAMember}
      onSetOrg={onSetOrg}
    />
  )

  OrgProvider.displayName = 'OrgProvider'

  return { useOrg, OrgProvider, notAMember }
}

/**
 * The tenancy of an app that finds the organization with the route's
 * `orgSlug` param and needs nothing else: `createTenancy()`. Pass it to the
 * `Router`:
 *
 *   <Router useAuth={useAuth} tenancy={tenancy}>
 */
export const tenancy = createTenancy()
