import type { ReactElement, ReactNode } from 'react'
import React, { useMemo, memo } from 'react'

import type { AuthTenancy } from '@cedarjs/auth' with {
  'resolution-mode': 'import',
}

import { ActiveRouteLoader } from './active-route-loader.js'
import { analyzeRoutes } from './analyzeRoutes.js'
import type { Wrappers } from './analyzeRoutes.js'
import { AuthenticatedRoute } from './AuthenticatedRoute.js'
import { LocationProvider, useLocation } from './location.js'
import { namedRoutes } from './namedRoutes.js'
import { normalizePage } from './page.js'
import { PageLoadingContextProvider } from './PageLoadingContext.js'
import { ParamsProvider } from './params.js'
import { Redirect } from './redirect.js'
import type { RouterContextProviderProps, Tenancy } from './router-context.js'
import { RouterContextProvider } from './router-context.js'
import { wrapWithSetWrappers } from './Set.js'
import { SplashPage } from './splash-page.js'
import { matchPath, parseSearch, replaceParams, validatePath } from './util.js'
import type { TrailingSlashesTypes } from './util.js'

/**
 * `tenancy`, only in an app with tenancy (see `AuthTenancy`), where sets have
 * `orgRoles` and `orgPermission`
 */
type RouterTenancy = AuthTenancy extends { enabled: true }
  ? {
      /**
       * How the router handles organizations: finding the one of the current
       * route, checking `orgRoles` and `orgPermission` in it, and providing
       * it to the layouts and page of a `PrivateSet`. Pass the `tenancy` from
       * `createTenancy` in `@cedarjs/tenancy/web`:
       *
       *   <Router useAuth={useAuth} tenancy={tenancy}>
       */
      tenancy?: Tenancy
    }
  : Record<never, never>

export interface RouterProps
  extends
    Omit<RouterContextProviderProps, 'routes' | 'activeRouteName' | 'tenancy'>,
    RouterTenancy {
  trailingSlashes?: TrailingSlashesTypes
  pageLoadingDelay?: number
  children: ReactNode
}

/**
 * The props the router reads. In an app without tenancy `RouterProps` has no
 * `tenancy`, but the router's own code is compiled as one, so it reads it
 * through this type, which `RouterProps` always fits.
 */
interface RouterImplementationProps extends RouterProps {
  tenancy?: Tenancy
}

const RouterImplementation: React.FC<RouterImplementationProps> = ({
  useAuth,
  tenancy,
  paramTypes,
  pageLoadingDelay,
  trailingSlashes = 'never',
  children,
}) => {
  return (
    // Level 1/3 (outer-most)
    // Wrap it in the provider so that useLocation can be used
    <LocationProvider trailingSlashes={trailingSlashes}>
      <LocationAwareRouter
        useAuth={useAuth}
        tenancy={tenancy}
        paramTypes={paramTypes}
        pageLoadingDelay={pageLoadingDelay}
      >
        {children}
      </LocationAwareRouter>
    </LocationProvider>
  )
}

// So React DevTools and error messages show the name apps use
RouterImplementation.displayName = 'Router'

export const Router: React.FC<RouterProps> = RouterImplementation

const LocationAwareRouter: React.FC<RouterImplementationProps> = ({
  useAuth,
  tenancy,
  paramTypes,
  pageLoadingDelay,
  children,
}) => {
  const location = useLocation()

  const analyzeRoutesResult = useMemo(() => {
    return analyzeRoutes(children, {
      currentPathName: location.pathname,
      // @TODO We haven't handled this with SSR/Streaming yet.
      // May need a babel plugin to extract userParamTypes from Routes.tsx
      userParamTypes: paramTypes,
    })
  }, [location.pathname, children, paramTypes])

  const {
    pathRouteMap,
    hasRootRoute,
    namedRoutesMap,
    NotFoundPage,
    activeRoutePath,
  } = analyzeRoutesResult

  const hasGeneratedRoutes = hasCustomRoutes(namedRoutesMap)
  const splashPageExists = typeof SplashPage !== 'undefined'
  const isOnNonExistentRootRoute = !hasRootRoute && location.pathname === '/'

  if (!hasRootRoute && splashPageExists) {
    namedRoutesMap['home'] = () => '/'
  }

  // Assign namedRoutes so it can be imported like import {routes} from 'rwjs/router'
  // Note that the value changes at runtime
  Object.assign(namedRoutes, namedRoutesMap)

  const shouldShowSplash =
    (isOnNonExistentRootRoute || !hasGeneratedRoutes) && splashPageExists

  if (shouldShowSplash) {
    return (
      <SplashPage
        hasGeneratedRoutes={hasGeneratedRoutes}
        allStandardRoutes={pathRouteMap}
      />
    )
  }

  // Render 404 page if no route matches
  if (!activeRoutePath) {
    if (NotFoundPage) {
      return (
        <RouterContextProvider
          useAuth={useAuth}
          tenancy={tenancy}
          paramTypes={paramTypes}
          routes={analyzeRoutesResult}
        >
          <ParamsProvider>
            <PageLoadingContextProvider delay={pageLoadingDelay}>
              <ActiveRouteLoader
                spec={normalizePage(NotFoundPage)}
                path={location.pathname}
              />
            </PageLoadingContextProvider>
          </ParamsProvider>
        </RouterContextProvider>
      )
    }

    return null
  }

  const { path, page, name, redirect, whileLoadingPage, sets } =
    pathRouteMap[activeRoutePath]

  if (!path) {
    throw new Error(`Route "${name}" needs to specify a path`)
  }

  // Check for issues with the path.
  validatePath(path, name || path)

  const { params: pathParams } = matchPath(path, location.pathname, {
    userParamTypes: paramTypes,
  })

  const searchParams = parseSearch(location.search)
  const allParams = { ...searchParams, ...pathParams }

  let redirectPath: string | undefined = undefined

  if (redirect) {
    if (redirect.startsWith('/')) {
      redirectPath = replaceParams(redirect, allParams)
    } else {
      const redirectRouteObject = Object.values(pathRouteMap).find(
        (route) => route.name === redirect,
      )

      if (!redirectRouteObject) {
        throw new Error(
          `Redirect target route "${redirect}" does not exist for route "${name}"`,
        )
      }

      redirectPath = replaceParams(redirectRouteObject.path, allParams)
    }
  }

  // Level 2/3 (LocationAwareRouter)
  return (
    <RouterContextProvider
      useAuth={useAuth}
      tenancy={tenancy}
      paramTypes={paramTypes}
      routes={analyzeRoutesResult}
      activeRouteName={name}
    >
      <ParamsProvider allParams={allParams}>
        <PageLoadingContextProvider delay={pageLoadingDelay}>
          {redirectPath && <Redirect to={redirectPath} />}
          {!redirectPath && page && (
            <WrappedPage sets={sets}>
              {/* Level 3/3 is inside ActiveRouteLoader */}
              <ActiveRouteLoader
                path={path}
                spec={normalizePage(page as any)}
                params={allParams}
                whileLoadingPage={whileLoadingPage as any}
              />
            </WrappedPage>
          )}
        </PageLoadingContextProvider>
      </ParamsProvider>
    </RouterContextProvider>
  )
}

interface WrappedPageProps {
  children: ReactNode
  sets: {
    id: string
    wrappers: Wrappers
    isPrivate: boolean
    props: {
      private?: boolean
      unauthenticated?: string
      unauthorized?: string
      roles?: string | string[]
      userRoles?: string | string[]
      orgRoles?: string | string[]
      orgPermission?: string
      whileLoadingAuth?: () => ReactElement | null
    }
  }[]
}

/**
 * This is effectively a Set (without auth-related code)
 *
 * This means that the <Set> and <PrivateSet> components become "virtual"
 * i.e. they are never actually Rendered, but their props are extracted by the
 * analyze routes function.
 *
 * This is so that we can have all the information up front in the routes-manifest
 * for SSR, but also so that we only do one loop of all the Routes.
 */
const WrappedPage = memo(({ sets, children }: WrappedPageProps) => {
  // @NOTE: don't mutate the wrappers array, it causes full page re-renders
  // Instead just create a new array with the AuthenticatedRoute wrapper

  if (!sets || sets.length === 0) {
    return children
  }

  return sets.reduceRight<ReactNode | undefined>((acc, set) => {
    // For each set in `sets`, if you have `<Set wrap={[A, B, C]} />` then
    // this will return
    // <A><B><C><routeLoaderElement /></C></B></A>
    // If you have `<PrivateSet wrap={[A, B, C]} />` instead it will return
    // <AuthenticatedRoute>
    //   <A><B><C><routeLoaderElement /></C></B></A>
    // </AuthenticatedRoute>
    let wrapped = wrapWithSetWrappers(set.wrappers, set.id, acc)

    // If set is private, wrap it in AuthenticatedRoute
    if (set.isPrivate) {
      const unauthenticated = set.props.unauthenticated
      if (!unauthenticated || typeof unauthenticated !== 'string') {
        throw new Error(
          'You must specify an `unauthenticated` route when using PrivateSet',
        )
      }

      // We do this last, to make sure that none of the wrapper elements are
      // rendered if the user isn't authenticated
      wrapped = (
        <AuthenticatedRoute
          unauthenticated={unauthenticated}
          unauthorized={set.props.unauthorized}
          roles={set.props.roles}
          userRoles={set.props.userRoles}
          orgRoles={set.props.orgRoles}
          orgPermission={set.props.orgPermission}
          whileLoadingAuth={set.props.whileLoadingAuth}
        >
          {wrapped}
        </AuthenticatedRoute>
      )
    }

    return wrapped
  }, children)
})

function hasCustomRoutes(obj: Record<string, unknown>) {
  for (const prop in obj) {
    if (Object.hasOwn(obj, prop)) {
      return true
    }
  }

  return false
}
