import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { EntryMeta } from '@universal-deploy/store'
import fg from 'fast-glob'
import { addRoute, createRouter, findRoute } from 'rou3'

import type { CedarHandler } from '@cedarjs/api/runtime'
import { buildCedarContext, requestToLegacyEvent } from '@cedarjs/api/runtime'
import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { getPaths } from '@cedarjs/project-config'

import type { Fetchable } from './udFetchable.js'
import { createCedarFetchable } from './udFetchable.js'

const ALL_HTTP_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'CONNECT',
  'TRACE',
] as const
const GRAPHQL_METHODS = ['GET', 'POST', 'OPTIONS'] as const

export interface CedarDispatcherOptions {
  apiRootPath?: string
  discoverFunctionsGlob?: string | string[]
}

export interface CedarDispatcherResult {
  fetchable: Fetchable
  registrations: EntryMeta[]
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

// TODO Phase 4 — the runtime function-discovery approach used here (scanning
// `api/dist/functions/` with fast-glob at startup) is temporary scaffolding
// for the period when Cedar's API is built with Babel/esbuild rather than
// Vite. Once Phase 4 moves the API to a Vite build, functions are bundled
// statically at build time and runtime discovery is no longer needed. At that
// point this function can be deleted (or retained only for a deliberate
// non-Vite standalone-serve mode). See the Phase 3 "Temporary scaffolding"
// section in docs/implementation-plans/universal-deploy-integration-plan-refined.md
/**
 * Shared inner routing logic used by both `createUDServer` (which wraps it in
 * srvx) and the Vite plugin's `virtual:cedar-api` module.
 *
 * Discovers Cedar API functions in `api/dist/functions/`, builds a rou3 router
 * and a map of route names to Fetchables, then returns a single Fetchable that
 * routes incoming Fetch-API requests to the correct per-function handler.
 * Also returns the list of `EntryMeta` registrations so callers can forward
 * them to `@universal-deploy/store` via `addEntry()`.
 */
export async function buildCedarDispatcher(
  options?: CedarDispatcherOptions,
): Promise<CedarDispatcherResult> {
  const normalizedApiRootPath = normalizeApiRootPath(
    options?.apiRootPath ?? '/',
  )
  const discoverFunctionsGlob =
    options?.discoverFunctionsGlob ?? 'dist/functions/**/*.{ts,js}'

  // Discover function files in api/dist/functions/
  // deep: 2 is intentional: with cwd=api/, depth 1 is dist/ and depth 2 is
  // dist/functions/, so one level of subdirectory nesting below
  // dist/functions/ (e.g. dist/functions/nested/nested.js) is supported but
  // deeper nesting is not. This matches the behaviour of the Fastify-based
  // lambdaLoader and @cedarjs/internal's findApiDistFunctions, which carry
  // the same deep: 2 limit with the explicit note "We don't support deeply
  // nested api functions, to maximise compatibility with deployment providers".
  // See packages/internal/src/files.ts
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

  const registrations: EntryMeta[] = []

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

      // Cast through unknown to bridge the CJS/ESM module resolution type
      // mismatch: the static import resolves to CJS types in a CJS build, while
      // the dynamic import always resolves to ESM types. Deriving the type from
      // createGraphQLYoga itself guarantees both sides use the same resolution.
      const graphqlOptions =
        fnImport.__rw_graphqlOptions as unknown as Parameters<
          typeof createGraphQLYoga
        >[0]

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

      registrations.push({
        id: routePath,
        route: routePath,
        method: [...GRAPHQL_METHODS],
      })

      for (const method of GRAPHQL_METHODS) {
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

    registrations.push({
      id: routePath,
      route: routePath,
      // method omitted → matches all HTTP methods per @universal-deploy/store docs
    })

    for (const method of ALL_HTTP_METHODS) {
      addRoute(router, method, routePath, routeName)
      addRoute(router, method, `${routePath}/**`, routeName)
    }
  }

  const fetchable: Fetchable = {
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
          const fnFetchable = fetchableMap.get(matchedRouteName)

          if (!fnFetchable) {
            return new Response('Not Found', { status: 404 })
          }

          try {
            return await fnFetchable.fetch(request)
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
  }

  return { fetchable, registrations }
}
