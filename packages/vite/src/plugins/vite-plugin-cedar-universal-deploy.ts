import path from 'node:path'

import { addEntry, type EntryMeta } from '@universal-deploy/store'
import type { Plugin } from 'vite'

import type { CedarRouteRecord } from '@cedarjs/api/runtime'
import { findApiServerFunctions } from '@cedarjs/internal/dist/files.js'
import { getPaths } from '@cedarjs/project-config'

export interface CedarUniversalDeployPluginOptions {
  apiRootPath?: string
}

const VIRTUAL_CEDAR_FN_PREFIX = 'virtual:cedar-api:fn:'
const RESOLVED_CEDAR_FN_PREFIX = '\0virtual:cedar-api:fn:'

/**
 * The Symbol.for key used by @universal-deploy/store to persist entries on
 * globalThis across Vite plugin instances and separate build calls.
 * We need direct access here so that cedarUniversalDeployPlugin can clear
 * stale entries before re-registering.
 */
const UD_STORE_SYMBOL = Symbol.for('ud:store')

const GRAPHQL_METHODS = ['GET', 'POST', 'OPTIONS'] as const

/**
 * Normalise apiRootPath: strip leading/trailing slashes, then prepend
 * exactly one `/` if the result is non-empty. For `/` (root) the prefix
 * is empty since routes already start with `/`.
 */
function normaliseApiPrefix(apiPrefix: string): string {
  apiPrefix = apiPrefix.trim()

  while (apiPrefix.startsWith('/')) {
    apiPrefix = apiPrefix.slice(1)
  }

  while (apiPrefix.endsWith('/')) {
    apiPrefix = apiPrefix.slice(0, -1)
  }

  return apiPrefix ? '/' + apiPrefix : ''
}

/**
 * Discovers Cedar API function source files and derives the production route
 * manifest from them. The manifest is the single source of truth for both
 * Cedar's backend routing and UD store registration.
 */
function discoverCedarRoutes(apiRootPath: string): CedarRouteRecord[] {
  const srcFunctions = getPaths().api.functions
  const distFunctions = path.join(getPaths().api.base, 'dist', 'functions')

  const sourceFiles = findApiServerFunctions(srcFunctions)

  const routes: CedarRouteRecord[] = []

  for (const sourcePath of sourceFiles) {
    const relative = path.relative(srcFunctions, sourcePath)
    const { dir, name, ext: _ext } = path.parse(relative)

    let routeName: string
    if (dir === name) {
      routeName = dir
    } else if (dir === '') {
      routeName = name
    } else if (dir.length && name === 'index') {
      routeName = dir
    } else {
      // Not a recognised function shape; skip.
      continue
    }

    const apiPrefix = normaliseApiPrefix(apiRootPath)
    const routePath =
      routeName === 'graphql'
        ? `${apiPrefix}/graphql`
        : `${apiPrefix}/${routeName}`
    const methods = routeName === 'graphql' ? [...GRAPHQL_METHODS] : []
    const type: CedarRouteRecord['type'] =
      routeName === 'graphql'
        ? 'graphql'
        : routeName === 'health'
          ? 'health'
          : routeName.toLowerCase().includes('auth')
            ? 'auth'
            : 'function'

    const distPath = path.join(distFunctions, dir, name + '.js')

    routes.push({
      id: routePath,
      path: routePath,
      methods,
      type,
      entry: distPath,
    })
  }

  // Ensure GraphQL is first for consistent ordering.
  const gqlIndex = routes.findIndex((r) => r.type === 'graphql')
  if (gqlIndex > 0) {
    const [gqlRoute] = routes.splice(gqlIndex, 1)
    routes.unshift(gqlRoute)
  }

  return routes
}

/**
 * Converts a Cedar route record into the `EntryMeta` shape expected by UD's
 * store. Route patterns include both the exact path and a `/**` wildcard so
 * that sub-paths (e.g. `/graphql/health`) are correctly matched.
 */
function toEntryMeta(route: CedarRouteRecord): EntryMeta {
  const routePatterns =
    route.path === '/**' ? ['/**'] : [route.path, `${route.path}/**`]

  return {
    id: `${VIRTUAL_CEDAR_FN_PREFIX}${route.id}`,
    route: routePatterns,
    ...(route.methods.length > 0 && {
      method: route.methods as EntryMeta['method'],
    }),
  }
}

/**
 * Remove any previously registered Cedar UD entries from the global store.
 *
 * This prevents stale entries (registered by an earlier Vite build step or by
 * a different plugin instance) from being picked up by UD's catchAll()
 * dispatcher. For example, when `cedar build --ud` runs the web client build
 * before the API server build, the user's web vite.config.ts may include
 * cedarUniversalDeployPlugin with a different apiRootPath, producing stale
 * entry IDs that the API build's load handler cannot resolve.
 */
function clearCedarEntries(): void {
  const store: { entries: { id?: string }[] } | undefined = (
    globalThis as Record<symbol, unknown>
  )[UD_STORE_SYMBOL] as { entries: { id?: string }[] } | undefined

  if (!store) {
    return
  }

  store.entries = store.entries.filter(
    (entry) => !entry.id?.startsWith(VIRTUAL_CEDAR_FN_PREFIX),
  )
}

export function cedarUniversalDeployPlugin(
  options: CedarUniversalDeployPluginOptions = {},
): Plugin {
  const { apiRootPath } = options
  const routes = discoverCedarRoutes(apiRootPath ?? '/')

  let entriesInjected = false

  return {
    name: 'cedar-universal-deploy',
    apply: 'build',

    config: {
      order: 'pre',
      handler() {
        if (entriesInjected) {
          return
        }
        entriesInjected = true

        // Clear any stale Cedar entries from previous build steps (e.g. the web
        // client build, which may use a different apiRootPath).
        // TODO: I think this is overly defensive. We should see if we can
        // remove this call (and the entire clearCedarEntries function)
        clearCedarEntries()

        // Register per-route API entries so UD adapters can split on
        // individual functions (e.g. Cloudflare Workers).
        for (const route of routes) {
          addEntry(toEntryMeta(route))
        }
      },
    },

    resolveId(id) {
      // Match the null-byte-prefixed form that Rollup uses for already-resolved
      // virtual modules (e.g. when UD's catchAll generates dynamic imports).
      if (id.startsWith(RESOLVED_CEDAR_FN_PREFIX)) {
        return id
      }

      if (id.startsWith(VIRTUAL_CEDAR_FN_PREFIX)) {
        return '\0' + id
      }

      return undefined
    },

    load(id) {
      // Per-function virtual modules
      if (id.startsWith(RESOLVED_CEDAR_FN_PREFIX)) {
        const routeId = id.slice(RESOLVED_CEDAR_FN_PREFIX.length)
        const route = routes.find((r) => r.id === routeId)

        if (!route) {
          return undefined
        }

        if (route.type === 'graphql') {
          return generateGraphQLModule(route.entry)
        }

        return generateFunctionModule(route.entry)
      }

      return undefined
    },
  }
}

function generateGraphQLModule(distPath: string): string {
  // Relative path from the UD entry output directory (api/dist/ud) to the
  // function dist file (api/dist/functions/...). Resolved at runtime via
  // import.meta.url so the artifact is portable between machines.
  const udOutDir = path.join(getPaths().api.dist, 'ud')
  const relPath = './' + path.relative(udOutDir, distPath)

  return `
    import { createGraphQLHandler } from '@cedarjs/vite/ud-handlers/graphql';
    export default createGraphQLHandler({ distUrl: new URL(${JSON.stringify(relPath)}, import.meta.url).href });
  `
}

function generateFunctionModule(distPath: string): string {
  const udOutDir = path.join(getPaths().api.dist, 'ud')
  const relPath = './' + path.relative(udOutDir, distPath)

  return `
    import { createFunctionHandler } from '@cedarjs/vite/ud-handlers/function';
    export default createFunctionHandler({ distUrl: new URL(${JSON.stringify(relPath)}, import.meta.url).href });
  `
}
