import type { ComponentType, ReactElement, ReactNode } from 'react'
import React from 'react'

import type { PermissionName } from '@cedarjs/auth' with {
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

interface SetProps {
  /**
   * Route is permitted when authenticated and user has any of the provided
   * roles such as "admin" or ["admin", "editor"], in `currentUser.roles`
   */
  roles?: string | string[]
  /**
   * Route is permitted when authenticated and the user has this permission
   * (see `cedar setup permissions`). With `roles` as well, they need both.
   *
   * Without tenancy, it's one of the user's own permissions, in
   * `currentUser.permissions`.
   *
   * With `tenancy` on the Router, it's a permission of the user's membership
   * in the route's organization: the one the Router's `tenancy` finds, by
   * default the one with the route's `orgSlug` param. A signed-in user who
   * isn't a member gets the tenancy's `notAMember`. A `PrivateSet` with
   * `permission` throws on a route that isn't in an organization.
   */
  permission?: PermissionName
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
   * without the required roles or permission. Without it, they're
   * redirected to `unauthenticated`.
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
