import React, { useContext } from 'react'

import { HasOrgRoleContext } from '@cedarjs/auth'

import { ParamsContext } from './params.js'
import { Redirect } from './redirect.js'
import { useRouterState } from './router-context.js'
import type { RouterState } from './router-context.js'
import { paramsForRoute } from './util.js'

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

/**
 * The path of the route named `name`, with the path params it needs taken
 * from `params`, the current route's params. So it can be a page that, say,
 * has the same `orgSlug` as the current one.
 */
function redirectPath(
  routes: RouterState['routes'],
  name: string,
  params: Record<string, string>,
) {
  const route = Object.values(routes.pathRouteMap).find(
    (candidate) => candidate.name === name,
  )

  // Own properties only, so a name like `toString` isn't a route
  if (!route || !Object.hasOwn(routes.namedRoutesMap, name)) {
    throw new Error(`We could not find a route named ${name}`)
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
  const hasOrgRole = useContext(HasOrgRoleContext)
  // Not every router renders this inside a ParamsProvider
  const params = useContext(ParamsContext)?.params ?? {}

  // Fail closed: with no organization to check `orgRoles` in, it's a mistake
  // in the routes, not a user without the role
  if (orgRoles !== undefined && !hasOrgRole) {
    throw new Error(
      'A PrivateSet with `orgRoles` needs the organization from OrgScope, ' +
        'and found none. Please nest the PrivateSet inside the Set that ' +
        'wraps OrgScope, rather than giving it OrgScope in its own `wrap`: ' +
        "a PrivateSet's checks run outside its own wrappers",
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
        to={redirectPath(routerState.routes, unauthorized, params)}
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
    params,
  )

  return (
    <Redirect to={`${unauthenticatedPath}?redirectTo=${currentLocation}`} />
  )
}
