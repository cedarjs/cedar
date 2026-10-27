import React, { createContext, useContext, useMemo } from 'react'

import type { AuthContextInterface } from '@cedarjs/auth' with {
  'resolution-mode': 'import',
}
import { useNoAuth } from '@cedarjs/auth'

import type { analyzeRoutes } from './analyzeRoutes.js'
import type { ParamType } from './util.js'

type UseAuth = () => AuthContextInterface<
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>

/**
 * Checks the user's role in the organization of the current route, for
 * `<PrivateSet orgRoles>`, given the router's `useAuth` and the route's path
 * params: `null` when the route isn't in an organization. In apps with
 * tenancy, `useOrgRoles` from `@cedarjs/tenancy/web` is one. The router
 * calls it like a hook, on every render of a private set.
 *
 * One of the app's own can answer in three ways:
 * - a check, which the router uses for `orgRoles`. One that always returns
 *   `false` denies access and redirects to `unauthorized`.
 * - `null`, for no organization: a set with `orgRoles` then throws the
 *   router's own error.
 * - throw an error of its own, such as for an organization that's been
 *   suspended. It reaches the app's error boundary like any error thrown
 *   while rendering.
 */
export type UseOrgRoles = (
  useAuth: UseAuth,
  params: Record<string, string>,
) => ((roles: string | string[]) => boolean) | null

export interface RouterState {
  paramTypes?: Record<string, ParamType>
  useAuth: UseAuth
  /** Unset in apps that don't pass one to the router */
  useOrgRoles?: UseOrgRoles
  routes: ReturnType<typeof analyzeRoutes>
  activeRouteName?: string | undefined | null
}

const RouterStateContext = createContext<RouterState | undefined>(undefined)

export interface RouterContextProviderProps extends Omit<
  RouterState,
  'useAuth'
> {
  useAuth?: UseAuth
  routes: ReturnType<typeof analyzeRoutes>
  activeRouteName?: string | undefined | null
  children: React.ReactNode
}

export const RouterContextProvider: React.FC<RouterContextProviderProps> = ({
  useAuth,
  useOrgRoles,
  paramTypes,
  routes,
  activeRouteName,
  children,
}) => {
  const state = useMemo(
    () => ({
      useAuth: useAuth || useNoAuth,
      useOrgRoles,
      paramTypes,
      routes,
      activeRouteName,
    }),
    [useAuth, useOrgRoles, paramTypes, routes, activeRouteName],
  )

  return (
    <RouterStateContext.Provider value={state}>
      {children}
    </RouterStateContext.Provider>
  )
}

export const useRouterState = () => {
  const context = useContext(RouterStateContext)

  if (context === undefined) {
    throw new Error(
      'useRouterState must be used within a RouterContextProvider',
    )
  }

  return context
}
