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
