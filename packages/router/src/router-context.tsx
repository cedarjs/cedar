import React, { createContext, useContext, useMemo } from 'react'

import type { AuthContextInterface } from '@cedarjs/auth' with {
  'resolution-mode': 'import',
}
import { useNoAuth } from '@cedarjs/auth'

import type { analyzeRoutes } from './analyzeRoutes.js'
import type { ParamType } from './util.js'

export type UseAuth = () => AuthContextInterface<
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
 * What the router reads of a membership in an organization. A tenancy's
 * memberships can have more; the router passes them on to its `OrgProvider`
 * as they are.
 */
export interface RouterMembership {
  /** Identifies the organization, so one provider stays mounted across it */
  organizationId: string
  /** The user's role in the organization, for `<PrivateSet orgRoles>` */
  role: string
  /** What the membership may do, for `<PrivateSet orgPermission>` */
  permissions?: readonly string[] | undefined
}

/**
 * What a tenancy's `useOrg` found for a route in an organization. A
 * `membership` of `null` means the signed-in user isn't a member of it, or
 * isn't signed in.
 */
export interface RouterOrg {
  membership: RouterMembership | null
  memberships: readonly RouterMembership[]
}

/**
 * Finds the organization of the current route, given the router's `useAuth`
 * and the route's path params: `null` when the route isn't in an
 * organization. The router calls it like a hook, on every render of a
 * private set.
 *
 * One of the app's own can answer in three ways:
 * - an organization, with the user's membership in it or `null` for none.
 *   A set with `orgRoles` or `orgPermission` denies a user with no
 *   membership, and the router renders the tenancy's `notAMember`.
 * - `null`, for no organization: a set with `orgRoles` or `orgPermission`
 *   then throws the router's own error.
 * - throw an error of its own, such as for an organization that's been
 *   suspended. It reaches the app's error boundary like any error thrown
 *   while rendering.
 */
export type UseOrg = (
  useAuth: UseAuth,
  params: Record<string, string>,
) => RouterOrg | null

/** What the router gives a tenancy's `OrgProvider` */
export interface OrgProviderProps {
  useAuth: UseAuth
  membership: RouterMembership
  memberships: readonly RouterMembership[]
  children: React.ReactNode
}

/**
 * How the router handles organizations. `createTenancy` from
 * `@cedarjs/tenancy/web` makes one. The router renders its `OrgProvider`
 * around the layouts and page of a `PrivateSet` whose route is in an
 * organization, and checks `orgRoles` and `orgPermission` against the
 * membership its `useOrg` finds.
 */
export interface Tenancy {
  useOrg: UseOrg
  /** Provides the organization to everything below it */
  OrgProvider: React.ComponentType<OrgProviderProps>
  /** Rendered for a signed-in user who isn't a member of the route's organization */
  notAMember?: React.ReactNode
}

export interface RouterState {
  paramTypes?: Record<string, ParamType>
  useAuth: UseAuth
  /** Unset in apps that don't pass one to the router */
  tenancy?: Tenancy
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
  tenancy,
  paramTypes,
  routes,
  activeRouteName,
  children,
}) => {
  const state = useMemo(
    () => ({
      useAuth: useAuth || useNoAuth,
      tenancy,
      paramTypes,
      routes,
      activeRouteName,
    }),
    [useAuth, tenancy, paramTypes, routes, activeRouteName],
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
