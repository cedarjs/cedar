import React, { createContext, useContext } from 'react'

import { useLocation } from './location.js'
import { Redirect } from './redirect.js'
import { useRouterState } from './router-context.js'
import type { RouterState, UseOrg } from './router-context.js'
import { paramsForRoute, pathParamsText } from './util.js'

interface AuthenticatedRouteProps {
  children: React.ReactNode
  roles?: string | string[]
  orgPermission?: string
  unauthenticated: string
  unauthorized?: string
  whileLoadingAuth?: () => React.ReactElement | null
}

const REPLACE = { replace: true }

/** For a router without `tenancy`: no organization to find */
const useNoOrg: UseOrg = () => null

/**
 * The id of the organization whose provider is mounted above, so a private
 * set inside another one in the same organization doesn't render a second
 * provider
 */
const MountedOrgContext = createContext<string | undefined>(undefined)

/**
 * The current route's path params, as the text in the URL's path, so they go
 * into another route's path unchanged
 */
function currentPathParams(routerState: RouterState, pathname: string) {
  const route = Object.values(routerState.routes.pathRouteMap).find(
    (candidate) => candidate.name === routerState.activeRouteName,
  )

  if (!route?.path) {
    return {}
  }

  return pathParamsText(route.path, pathname, routerState.paramTypes)
}

/**
 * The path of the route named `name`, with the path params it needs taken
 * from `params`, the current route's path params. So it can be a page that,
 * say, has the same `orgSlug` as the current one.
 */
function redirectPath(
  routes: RouterState['routes'],
  name: string,
  params: Record<string, string>,
) {
  // Own properties only, so a name like `toString` isn't a route
  if (!Object.hasOwn(routes.namedRoutesMap, name)) {
    throw new Error(`We could not find a route named ${name}`)
  }

  const route = Object.values(routes.pathRouteMap).find(
    (candidate) => candidate.name === name,
  )

  // A route without a path of its own, like the splash page's `home`
  if (!route) {
    return routes.namedRoutesMap[name]()
  }

  const routeParams: Record<string, string> = {}

  for (const [paramName] of paramsForRoute(route.path)) {
    const value = params[paramName]

    if (value === undefined) {
      throw new Error(
        `Redirecting to route "${name}" requires the route parameter ` +
          `"${paramName}", which the current route doesn't have. Please ` +
          'choose a different route',
      )
    }

    routeParams[paramName] = value
  }

  try {
    return routes.namedRoutesMap[name](routeParams)
  } catch {
    throw new Error(`Could not redirect to the route named ${name}`)
  }
}

export const AuthenticatedRoute: React.FC<AuthenticatedRouteProps> = ({
  unauthenticated,
  unauthorized,
  roles,
  orgPermission,
  whileLoadingAuth,
  children,
}) => {
  const routerState = useRouterState()
  const mountedOrgId = useContext(MountedOrgContext)
  const {
    loading: authLoading,
    isAuthenticated,
    hasRole,
  } = routerState.useAuth()
  // The router's location, not `globalThis.location`, which there isn't when
  // prerendering
  const { pathname } = useLocation()
  const pathParams = currentPathParams(routerState, pathname)
  const { tenancy } = routerState
  // Called on every render, with or without `orgPermission`, as hooks must be
  // called the same way every time
  const useOrg = tenancy?.useOrg ?? useNoOrg
  const org = useOrg(routerState.useAuth, pathParams)
  const needsOrg = orgPermission !== undefined

  // Fail closed: with no organization to check `orgPermission` in, it's a mistake in the routes, not a user without access. A router
  // without `tenancy` is a mistake whatever the auth state. A `useOrg` that
  // finds no organization may only be because auth is still loading, such as
  // when prerendering with an organization from the host, so that waits for
  // auth to load.
  if (needsOrg && !org) {
    if (!tenancy) {
      throw new Error(
        'A PrivateSet with `orgPermission` needs `tenancy` on the Router to ' +
          'find the organization with. Please pass `tenancy` from ' +
          '`@cedarjs/tenancy/web`: ' +
          '<Router useAuth={useAuth} tenancy={tenancy}>',
      )
    }

    if (authLoading) {
      return whileLoadingAuth?.() || null
    }

    if (pathParams['orgSlug'] === undefined) {
      throw new Error(
        'A PrivateSet with `orgPermission` needs an organization to check ' +
          'it in, and the route has no `orgSlug` param. Please only use ' +
          '`orgPermission` on routes with `{orgSlug}` in their path, or ' +
          'pass `createTenancy` a `useOrg` that finds the organization ' +
          'another way',
      )
    }

    // A `useOrg` of the app's own found no organization for this route
    throw new Error(
      'A PrivateSet with `orgPermission` got no organization from the ' +
        "Router's `tenancy` for this route, so there is nothing to check " +
        'it in',
    )
  }

  const hasRequiredRoles = !roles || hasRole(roles)

  if (isAuthenticated && hasRequiredRoles) {
    // A route that isn't in an organization is an ordinary private route
    if (!tenancy || !org) {
      return <>{children}</>
    }

    const { membership, memberships } = org

    if (!membership) {
      // The user's memberships may still be on their way
      if (authLoading) {
        return whileLoadingAuth?.() || null
      }

      return <>{tenancy.notAMember ?? null}</>
    }

    const hasRequiredOrgAccess =
      orgPermission === undefined ||
      (membership.permissions?.includes(orgPermission) ?? false)

    if (hasRequiredOrgAccess) {
      // An outer private set in this organization has rendered the provider
      if (mountedOrgId === membership.organizationId) {
        return <>{children}</>
      }

      // Keyed by the organization, not the route or the set, so the provider
      // stays mounted across the organization's pages
      return (
        <tenancy.OrgProvider
          key={membership.organizationId}
          useAuth={routerState.useAuth}
          membership={membership}
          memberships={memberships}
        >
          <MountedOrgContext.Provider value={membership.organizationId}>
            {children}
          </MountedOrgContext.Provider>
        </tenancy.OrgProvider>
      )
    }
  }

  if (authLoading) {
    return whileLoadingAuth?.() || null
  }

  // Signed in, but without the required roles or permission
  if (isAuthenticated && unauthorized) {
    return (
      <Redirect
        to={redirectPath(routerState.routes, unauthorized, pathParams)}
        options={REPLACE}
      />
    )
  }

  const currentLocation =
    globalThis.location.pathname +
    encodeURIComponent(globalThis.location.search)

  const unauthenticatedPath = redirectPath(
    routerState.routes,
    unauthenticated,
    pathParams,
  )

  return (
    <Redirect to={`${unauthenticatedPath}?redirectTo=${currentLocation}`} />
  )
}
