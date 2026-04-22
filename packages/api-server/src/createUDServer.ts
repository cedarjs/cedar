import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { addEntry } from '@universal-deploy/store'
import fg from 'fast-glob'
import { addRoute, createRouter, findRoute } from 'rou3'
import { serve } from 'srvx'
import type { Server } from 'srvx'

import type { CedarHandler } from '@cedarjs/api/runtime'
import { buildCedarContext, requestToLegacyEvent } from '@cedarjs/api/runtime'
import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { getPaths } from '@cedarjs/project-config'

import type { Fetchable } from './udFetchable.js'
import { createCedarFetchable } from './udFetchable.js'

export interface CreateUDServerOptions {
  port?: number
  host?: string
  apiRootPath?: string
  discoverFunctionsGlob?: string | string[]
}

/**
 * Normalizes the api root path so it always starts and ends with a `/`.
 * e.g. `v1` → `/v1/`, `/v1` → `/v1/`, `/` → `/`
 */
function normalizeApiRootPath(rootPath: string): string {
  let normalized = rootPath

  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  if (!normalized.endsWith('/')) {
    normalized = normalized + '/'
  }

  return normalized
}

/**
 * Creates a WinterTC-compatible HTTP server using srvx that serves Cedar API
 * functions discovered in `api/dist/functions/`.
 *
 * Each function is wrapped in a Fetchable and registered with the
 * `@universal-deploy/store` via `addEntry()`. The srvx fetch handler routes
 * incoming requests to the correct Fetchable using rou3 for URL pattern
 * matching.
 */
export async function createUDServer(
  options?: CreateUDServerOptions,
): Promise<Server> {
  const port = options?.port ?? 8911
  const host = options?.host
  const normalizedApiRootPath = normalizeApiRootPath(
    options?.apiRootPath ?? '/',
  )
  const discoverFunctionsGlob =
    options?.discoverFunctionsGlob ?? 'dist/functions/**/*.{ts,js}'

  // Discover function files in api/dist/functions/
  const serverFunctions = fg.sync(discoverFunctionsGlob, {
    cwd: getPaths().api.base,
    deep: 2,
    absolute: true,
  })

  // Put the graphql function first for consistent load ordering
  const graphqlIdx = serverFunctions.findIndex(
    (x) => path.basename(x, path.extname(x)) === 'graphql',
  )

  if (graphqlIdx >= 0) {
    const [graphqlFn] = serverFunctions.splice(graphqlIdx, 1)
    serverFunctions.unshift(graphqlFn)
  }

  // Build fetchable map: routeName -> Fetchable
  const fetchableMap = new Map<string, Fetchable>()

  // Build rou3 router for URL pattern matching
  const router = createRouter<string>()

  for (const fnPath of serverFunctions) {
    const routeName = path.basename(fnPath, path.extname(fnPath))
    const routePath = routeName === 'graphql' ? '/graphql' : `/${routeName}`

    const fnImport = await import(pathToFileURL(fnPath).href)

    // Check if this is a GraphQL function — the babel plugin adds
    // `__rw_graphqlOptions` to api/dist/functions/graphql.js
    if (
      '__rw_graphqlOptions' in fnImport &&
      fnImport.__rw_graphqlOptions != null
    ) {
      const { createGraphQLYoga } = await import('@cedarjs/graphql-server')
      const graphqlOptions = fnImport.__rw_graphqlOptions as GraphQLYogaOptions

      const { yoga } = createGraphQLYoga(graphqlOptions)

      const graphqlFetchable: Fetchable = {
        async fetch(request: Request): Promise<Response> {
          const cedarContext = await buildCedarContext(request, {
            authDecoder: graphqlOptions.authDecoder,
          })
          const event = await requestToLegacyEvent(request, cedarContext)

          // Phase 1 transitional context bridge: pass both Fetch-native fields
          // (request, cedarContext) and legacy bridge fields (event,
          // requestContext) so that Cedar-owned Yoga plugins that have not yet
          // migrated to the Fetch-native shape continue to work.
          return yoga.handle(request, {
            request,
            cedarContext,
            event,
            requestContext: undefined,
          })
        },
      }

      fetchableMap.set(routeName, graphqlFetchable)

      const graphqlMethods = ['GET', 'POST', 'OPTIONS'] as const

      addEntry({
        id: routePath,
        route: routePath,
        method: [...graphqlMethods],
      })

      for (const method of graphqlMethods) {
        addRoute(router, method, routePath, routeName)
        addRoute(router, method, `${routePath}/**`, routeName)
      }

      // Skip regular handler processing for the graphql function
      continue
    }

    // Only Fetch-native handlers are supported by the Universal Deploy server.
    // Functions that export only a legacy Lambda-shaped `handler` are not
    // WinterTC-compatible and must be migrated to `export async function
    // handle(request, ctx)` before they can be served by this runtime.
    const cedarHandler: CedarHandler | undefined = (() => {
      if ('handle' in fnImport && typeof fnImport.handle === 'function') {
        return fnImport.handle as CedarHandler
      }

      if (
        'default' in fnImport &&
        fnImport.default != null &&
        'handle' in fnImport.default &&
        typeof fnImport.default.handle === 'function'
      ) {
        return fnImport.default.handle as CedarHandler
      }

      return undefined
    })()

    if (!cedarHandler) {
      console.warn(
        routeName,
        'at',
        fnPath,
        'does not export a Fetch-native `handle` function and will not be' +
          ' served by the Universal Deploy server. Migrate to' +
          ' `export async function handle(request, ctx)` or use' +
          ' `yarn cedar serve` for legacy Lambda-shaped handler support.',
      )
      continue
    }

    const handler = cedarHandler

    fetchableMap.set(routeName, createCedarFetchable(handler))

    const regularMethods = ['GET', 'POST'] as const

    addEntry({
      id: routePath,
      route: routePath,
      method: [...regularMethods],
    })

    for (const method of regularMethods) {
      addRoute(router, method, routePath, routeName)
      addRoute(router, method, `${routePath}/**`, routeName)
    }
  }

  const server = serve({
    port,
    hostname: host,
    fetch(request: Request): Promise<Response> {
      return getAsyncStoreInstance().run(
        new Map<string, GlobalContext>(),
        async () => {
          const url = new URL(request.url)
          let routePathname = url.pathname

          // Strip the apiRootPath prefix so that `/api/hello` becomes `/hello`
          if (
            normalizedApiRootPath !== '/' &&
            routePathname.startsWith(normalizedApiRootPath)
          ) {
            // normalizedApiRootPath ends with '/', so slice length - 1 to keep
            // the leading slash on the remaining path segment
            routePathname = routePathname.slice(
              normalizedApiRootPath.length - 1,
            )
          }

          if (!routePathname.startsWith('/')) {
            routePathname = '/' + routePathname
          }

          const match = findRoute(router, request.method, routePathname)

          if (!match) {
            return new Response('Not Found', { status: 404 })
          }

          const matchedRouteName = match.data
          const fetchable = fetchableMap.get(matchedRouteName)

          if (!fetchable) {
            return new Response('Not Found', { status: 404 })
          }

          try {
            return await fetchable.fetch(request)
          } catch (err) {
            console.error(
              'Unhandled error in fetch handler for route',
              matchedRouteName,
              err,
            )
            return new Response('Internal Server Error', { status: 500 })
          }
        },
      )
    },
  })

  await server.ready()

  return server
}
