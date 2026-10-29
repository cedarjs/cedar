import type { ReactElement, ReactNode } from 'react'
import { Children } from 'react'

import type { PageType } from './page.js'
import {
  isNotFoundRoute,
  isRedirectRoute,
  isStandardRoute,
  isValidRoute,
} from './route-validators.js'
import { isPrivateNode, isPrivateSetNode, isSetNode } from './Set.js'
import type { WrapperType } from './Set.js'
import {
  matchPath,
  replaceParams,
  validatePath,
  type ParamType,
} from './util.js'

type WhileLoadingPage = () => ReactElement | null

// Not using AvailableRoutes because the type is generated in the user's project
// We can't index it correctly in the framework
export type GeneratedRoutesMap = {
  [key: string]: (
    args?: Record<string | number, string | number | boolean>,
  ) => string
}

export type Wrappers = readonly WrapperType[]

/**
 * The props of a `<Set>`, `<PrivateSet>` or `<Private>` that the router needs
 * when rendering a route in it
 */
interface SetRenderProps {
  private?: boolean
  unauthenticated?: string
  unauthorized?: string
  roles?: string | string[]
  // An app with tenancy has these instead of `roles` (see `SetRoles`)
  userRoles?: string | string[]
  orgPermission?: string
  whileLoadingAuth?: () => ReactElement | null
}

interface Set {
  id: string
  wrappers: Wrappers
  isPrivate: boolean
  props: SetRenderProps
}

/** Copies the props the router needs to render routes in a set */
function pickSetRenderProps(props: SetRenderProps) {
  const picked: SetRenderProps = {}

  if (props.private !== undefined) {
    picked.private = props.private
  }

  if (props.unauthenticated !== undefined) {
    picked.unauthenticated = props.unauthenticated
  }

  if (props.unauthorized !== undefined) {
    picked.unauthorized = props.unauthorized
  }

  if (props.roles !== undefined) {
    picked.roles = props.roles
  }

  if (props.userRoles !== undefined) {
    picked.userRoles = props.userRoles
  }

  if (props.orgPermission !== undefined) {
    picked.orgPermission = props.orgPermission
  }

  if (props.whileLoadingAuth !== undefined) {
    picked.whileLoadingAuth = props.whileLoadingAuth
  }

  return picked
}

function toWrappersArray(wrap: WrapperType | Wrappers | undefined): Wrappers {
  if (!wrap) {
    return []
  }

  // Array.isArray doesn't narrow readonly arrays, so we check for the single
  // wrapper case instead
  return isSingleWrapper(wrap) ? [wrap] : wrap
}

function isSingleWrapper(wrap: WrapperType | Wrappers): wrap is WrapperType {
  return !Array.isArray(wrap)
}

type RoutePath = string

/**
 * This is essentially the same as RouteProps
 * but it allows for page and redirect to be null or undefined
 * Keeping the shape consistent makes it easier to use
 */
interface AnalyzedRoute {
  path: RoutePath
  name: string | null
  whileLoadingPage?: WhileLoadingPage
  page: PageType | null
  redirect: string | null
  sets: Set[]
}

interface AnalyzeRoutesOptions {
  currentPathName: string
  userParamTypes?: Record<string, ParamType>
}

export function analyzeRoutes(
  children: ReactNode,
  { currentPathName, userParamTypes }: AnalyzeRoutesOptions,
) {
  const pathRouteMap: Record<RoutePath, AnalyzedRoute> = {}
  const namedRoutesMap: GeneratedRoutesMap = {}
  let hasRootRoute = false
  let NotFoundPage: PageType | undefined
  let activeRoutePath: string | undefined

  interface RecurseParams {
    nodes: ReturnType<typeof Children.toArray>
    whileLoadingPageFromSet?: WhileLoadingPage
    sets?: Set[]
  }

  // Assign ids to all sets found.
  // Because Sets are virtually rendered we can use this id as a key to
  // properly manage re-rendering when using the same wrapper Component for
  // different Sets
  //
  // Example:
  // <Router>
  //   <Set wrap={SetContextProvider}> // id: '1'
  //     <Route path="/" page={HomePage} name="home" />
  //     <Route path="/ctx-1-page" page={Ctx1Page} name="ctx1" />
  //     <Set wrap={Ctx2Layout}> // id: '1.1'
  //       <Route path="/ctx-2-page" page={Ctx2Page} name="ctx2" />
  //     </Set>
  //   </Set>
  //   <Set wrap={SetContextProvider}> // id: '2'
  //     <Route path="/ctx-3-page" page={Ctx3Page} name="ctx3" />
  //   </Set>
  // </Router>

  const recurseThroughRouter = ({
    nodes,
    whileLoadingPageFromSet,
    sets: previousSets = [],
  }: RecurseParams) => {
    let nextSetId = 0

    nodes.forEach((node) => {
      if (isValidRoute(node)) {
        // Rename for readability
        const route = node

        // We don't add not found pages to our list of named routes
        if (isNotFoundRoute(route)) {
          NotFoundPage = route.props.page
          // Don't add notFound routes to the maps, and exit early
          // @TODO: We may need to add it to the map, because you can in
          // theory wrap a notfound page in a Set wrapper
          return
        }

        // Used to decide whether to display SplashPage
        if (route.props.path === '/') {
          hasRootRoute = true
        }

        if (isRedirectRoute(route)) {
          const { name, redirect, path } = route.props

          // The name is just for showing a human-readable error message
          validatePath(path, name || path)

          const { match } = matchPath(path, currentPathName, {
            userParamTypes,
          })

          // Check if we already have an active path to only return the first match
          if (match && !activeRoutePath) {
            activeRoutePath = path
          }

          // If the redirect route doesn't have a name, no need to add it to the map
          pathRouteMap[path] = {
            redirect,
            name: name || null,
            path,
            page: null, // Redirects don't need pages. We set this to null for consistency
            sets: previousSets,
          }

          if (name) {
            namedRoutesMap[name] = (args = {}) => replaceParams(path, args)
          }
        }

        if (isStandardRoute(route)) {
          const { name, path, page } = route.props
          // Will throw if invalid path
          validatePath(path, name)

          const { match } = matchPath(path, currentPathName, {
            userParamTypes,
          })

          // Check if we already have an active path to only return the first match
          if (match && !activeRoutePath) {
            activeRoutePath = path
          }

          // e.g. namePathMap['homePage'] = { name: 'homePage', path: '/home', ...}
          // We always set all the keys, even if their values are null/undefined for consistency
          pathRouteMap[path] = {
            redirect: null,
            name,
            path,
            whileLoadingPage:
              route.props.whileLoadingPage || whileLoadingPageFromSet,
            page,
            sets: previousSets,
          }

          // Example: namedRoutesMap.home = () => '/home'
          // Example: namedRoutesMap.userExample = (args) => `/user-examples/${args.id}`
          namedRoutesMap[name] = (args = {}) => replaceParams(path, args)
        }
      }

      // @NOTE: A <PrivateSet> is also a Set
      if (isSetNode(node)) {
        const {
          children,
          whileLoadingPage: whileLoadingPageFromCurrentSet,
          wrap: wrapFromCurrentSet,
        } = node.props

        nextSetId = nextSetId + 1

        recurseThroughRouter({
          nodes: Children.toArray(children),
          // When there's a whileLoadingPage prop on a Set, we pass it down to all its children
          // If the parent node was also a Set with whileLoadingPage, we pass it down. The child's whileLoadingPage
          // will always take precedence over the parent's
          whileLoadingPageFromSet:
            whileLoadingPageFromCurrentSet || whileLoadingPageFromSet,
          sets: [
            ...previousSets,
            {
              id: createSetId(nextSetId, previousSets),
              wrappers: toWrappersArray(wrapFromCurrentSet),
              isPrivate:
                isPrivateSetNode(node) ||
                // The following two conditions can be removed when we remove
                // the deprecated private prop
                isPrivateNode(node) ||
                !!node.props.private,
              props: pickSetRenderProps(node.props),
            },
          ],
        })
      }
    })
  }

  recurseThroughRouter({ nodes: Children.toArray(children) })

  return {
    pathRouteMap,
    namedRoutesMap,
    hasRootRoute,
    NotFoundPage,
    activeRoutePath,
  }
}

function createSetId(nextSetId: number, previousSets: Set[]) {
  const firstLevel = previousSets.length === 0

  if (firstLevel) {
    // For the first level we don't want to add any dots ('.') to the id like
    // we do for all other levels
    return nextSetId.toString()
  }

  return previousSets.at(-1)?.id + '.' + nextSetId
}
