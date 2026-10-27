import React from 'react'

import { Redirect } from './redirect.js'
import { useRouterState } from './router-context.js'
import type { RouterState, UseOrgRoles } from './router-context.js'
import { paramsForRoute, pathParamsText } from './util.js'

interface AuthenticatedRouteProps {
  children: React.ReactNode | Thenable<React.ReactNode>
  roles?: string | string[]
  userRoles?: string | string[]
  orgRoles?: string | string[]
  unauthenticated: string
  unauthorized?: string
  whileLoadingAuth?: () => React.ReactElement | null
}

const REPLACE = { replace: true }

/** For a router without `useOrgRoles`: no organization to check a role in */
const useNoOrgRoles: UseOrgRoles = () => null

/**
 * The current route's path params, as the text in the URL's path, so they go
 * into another route's path unchanged
 */
function currentPathParams(routerState: RouterState) {
  const route = Object.values(routerState.routes.pathRouteMap).find(
    (candidate) => candidate.name === routerState.activeRouteName,
  )

  if (!route?.path) {
    return {}
  }

  return pathParamsText(
    route.path,
    globalThis.location.pathname,
    routerState.paramTypes,
  )
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
  userRoles,
  orgRoles,
  whileLoadingAuth,
  children,
}) => {
  const routerState = useRouterState()
  // `hasRole` is in the router's own type for `useAuth`, which is the one
  // without tenancy. Auth providers provide it in every app, also where the
  // app's types only show `hasUserRole`, which is the same check.
  const {
    loading: authLoading,
    isAuthenticated,
    hasRole,
  } = routerState.useAuth()
  const pathParams = currentPathParams(routerState)
  // Called on every render, with or without `orgRoles`, as hooks must be
  const useOrgRoles = routerState.useOrgRoles ?? useNoOrgRoles
  const hasOrgRole = useOrgRoles(routerState.useAuth, pathParams)

  // Fail closed: with no organization to check `orgRoles` in, it's a mistake
  // in the routes, not a user without the role
  if (orgRoles !== undefined && !hasOrgRole) {
    if (!routerState.useOrgRoles) {
      throw new Error(
        'A PrivateSet with `orgRoles` needs `useOrgRoles` on the Router to ' +
          'check the role with. Please pass `useOrgRoles` from ' +
          '`@cedarjs/tenancy/web`: ' +
          '<Router useAuth={useAuth} useOrgRoles={useOrgRoles}>',
      )
    }

    throw new Error(
      'A PrivateSet with `orgRoles` needs an organization to check the role ' +
        'in, and the route has no `orgSlug` param. Please only use ' +
        '`orgRoles` on routes with `{orgSlug}` in their path',
    )
  }

  const hasRequiredRoles =
    (!roles || hasRole(roles)) &&
    (!userRoles || hasRole(userRoles)) &&
    (orgRoles === undefined || (!!hasOrgRole && hasOrgRole(orgRoles)))

  if (isAuthenticated && hasRequiredRoles) {
    return <>{children}</>
  }

  if (authLoading) {
    return whileLoadingAuth?.() || null
  }

  // Signed in, but without the required roles
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
