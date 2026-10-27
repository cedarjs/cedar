import type { ComponentType, ReactElement, ReactNode } from 'react'
import React from 'react'

import type { AuthTenancy, PermissionName } from '@cedarjs/auth' with {
  'resolution-mode': 'import',
}

/**
 * The props `<Set>` gives each component in its `wrap` prop: the wrapped
 * routes as `children`, and nothing else
 */
export interface WrapperProps {
  children: ReactNode
}

/**
 * A component in a `<Set wrap>` prop, like a layout. The router renders it
 * with {@link WrapperProps}, so it can't have any other required props.
 * Optional props are fine.
 *
 * To render a layout with props, create a component that renders it with
 * those props, and use that component in `wrap`:
 *
 *   function PostsScaffoldLayout({ children }: WrapperProps) {
 *     return <ScaffoldLayout title="Posts" titleTo="posts">{children}</ScaffoldLayout>
 *   }
 *
 *   <Set wrap={PostsScaffoldLayout}>
 */
export type WrapperType = ComponentType<WrapperProps>

/**
 * The role props. An app with tenancy (see `AuthTenancy`) has `userRoles` and
 * `orgRoles` instead of `roles`: there, every role check says which kind it
 * is. It also has `orgPermission`.
 */
type SetRoles = AuthTenancy extends { enabled: true }
  ? {
      /**
       * Route is permitted when authenticated and user has any of the
       * provided roles such as "admin" or ["admin", "editor"], in
       * `currentUser.roles`, as opposed to a role in the organization they're
       * in (see `orgRoles`). With `orgRoles` as well, they need both.
       */
      userRoles?: string | string[]
      /**
       * Route is permitted when authenticated and user has any of the
       * provided roles such as "owner" or ["owner", "admin"] in the current
       * organization. With `userRoles` as well, they need both.
       *
       * The organization is the one the Router's `tenancy` finds for the
       * route, by default the one with the route's `orgSlug` param:
       *
       *   <Router useAuth={useAuth} tenancy={tenancy}>
       *
       * A `PrivateSet` with `orgRoles` throws without `tenancy` on the
       * router, or on a route that isn't in an organization.
       */
      orgRoles?: string | string[]
      /**
       * Route is permitted when authenticated and the user's membership in
       * the current organization has this permission (see
       * `createPermissions` in `@cedarjs/tenancy`). The organization is found
       * like for `orgRoles`, which it can be combined with: they need both.
       */
      orgPermission?: PermissionName
    }
  : {
      /**
       * Route is permitted when authenticated and user has any of the
       * provided roles such as "admin" or ["admin", "editor"], in
       * `currentUser.roles`
       */
      roles?: string | string[]
    }

interface SetProps extends SetRoles {
  /**
   * Components to wrap all routes in this set with, like layouts. The first
   * one in an array is the outermost one.
   *
   *   <Set wrap={[MainLayout, DarkThemeLayout]}>
   */
  wrap?: WrapperType | readonly WrapperType[]
  /**
   *`Routes` nested in a `<Set>` with `private` specified require
   * authentication. When a user is not authenticated and attempts to visit
   * the wrapped route they will be redirected to `unauthenticated` route.
   *
   * @deprecated Please use `<PrivateSet>` instead
   */
  private?: boolean
  /**
   * The page name where a user will be redirected when not authenticated
   *
   * @deprecated Please use `<PrivateSet>` instead and specify this prop there
   */
  unauthenticated?: string
  /**
   * The page name where a user will be redirected when authenticated but
   * without the required roles
   *
   * @deprecated Please use `<PrivateSet>` instead and specify this prop there
   */
  unauthorized?: string
  /** Prerender all pages in the set */
  prerender?: boolean
  children: ReactNode
  /** Loading state for auth to distinguish with whileLoading */
  whileLoadingAuth?: () => ReactElement | null
  whileLoadingPage?: () => ReactElement | null
}

/**
 * Groups routes, to wrap them all in the same layouts or other components, or
 * to give them all the same `whileLoadingPage` or `prerender` setting.
 *
 *   <Set wrap={MainLayout}>
 *     <Route path="/" page={HomePage} name="home" />
 *   </Set>
 */
export function Set(props: SetProps) {
  // @MARK: Virtual Component, this is actually never rendered
  // See analyzeRoutes in utils.tsx, inside the isSetNode block
  return <>{props.children}</>
}

type PrivateSetProps = Omit<
  SetProps,
  'private' | 'unauthenticated' | 'unauthorized'
> & {
  /**
   * The page name where a user will be redirected when not authenticated.
   * Also where one without the required roles is redirected, unless the set
   * has `unauthorized`.
   */
  unauthenticated: string
  /**
   * The page name where a user will be redirected when authenticated but
   * without the required roles. Without it, they're redirected to
   * `unauthenticated`.
   */
  unauthorized?: string
}

/** @deprecated Please use `<PrivateSet>` instead */
export function Private(props: PrivateSetProps) {
  // @MARK Virtual Component, this is actually never rendered
  // See analyzeRoutes in utils.tsx, inside the isSetNode block
  return <>{props.children}</>
}

/**
 * Wraps a set of routes that require the user to be authenticated before
 * rendering. Unauthenticated users are redirected to the route named by
 * `unauthenticated`, and users without the required roles to the one named by
 * `unauthorized`. Either route can have path params the current route has,
 * like `orgSlug`: they're filled in from the current route.
 *
 * In an app with tenancy, a `PrivateSet` whose routes have `{orgSlug}` in
 * their path provides the organization to its layouts and page, see `tenancy`
 * on the `Router`.
 *
 * Coming from React Router or a similar library and looking for something
 * like `RequireAuth` or `ProtectedRoute`? This is the Cedar equivalent.
 */
export function PrivateSet(props: PrivateSetProps) {
  // @MARK Virtual Component, this is actually never rendered
  // See analyzeRoutes in utils.tsx, inside the isSetNode block
  return <>{props.children}</>
}

export const isSetNode = (node: ReactNode): node is ReactElement<SetProps> => {
  return (
    React.isValidElement<SetProps>(node) &&
    (node.type === Set || node.type === PrivateSet || node.type === Private) &&
    // Don't even bother including Sets without children. They're useless.
    !!node.props.children
  )
}

export const isPrivateSetNode = (
  node: ReactNode,
): node is ReactElement<PrivateSetProps> => {
  return React.isValidElement(node) && node.type === PrivateSet
}

// Only identifies <Private> nodes, not <Set private> nodes
export const isPrivateNode = (
  node: ReactNode,
): node is ReactElement<PrivateSetProps> => {
  return React.isValidElement(node) && node.type === Private
}

/**
 * Wraps `children` in all `wrappers`, with the first wrapper as the outermost
 * one. Every wrapper gets `children` as its only prop.
 *
 *   wrapWithSetWrappers([A, B], '1', <Page />)
 *   // => <A><B><Page /></B></A>
 */
export function wrapWithSetWrappers(
  wrappers: readonly WrapperType[],
  setId: string,
  children: ReactNode,
) {
  return wrappers.reduceRight<ReactNode>((acc, Wrapper, index) => {
    return <Wrapper key={setId + '-' + index}>{acc}</Wrapper>
  }, children)
}
