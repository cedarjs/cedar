import path from 'node:path'

import { addEntry, catchAllEntry } from '@universal-deploy/store'
import type { EntryMeta } from '@universal-deploy/store'
import type { Plugin } from 'vite'

import type { CedarRouteRecord } from '@cedarjs/api/runtime'
import { findApiServerFunctions } from '@cedarjs/internal/dist/files.js'
import { getPaths } from '@cedarjs/project-config'

export interface CedarUniversalDeployPluginOptions {
  apiRootPath?: string
  webFallback?: boolean
}

const VIRTUAL_CEDAR_FN_PREFIX = 'virtual:cedar-api:fn:'
const RESOLVED_CEDAR_FN_PREFIX = '\0virtual:cedar-api:fn:'

const VIRTUAL_CEDAR_WEB = 'virtual:cedar-web'
const RESOLVED_VIRTUAL_CEDAR_WEB = '\0virtual:cedar-web'

const RESOLVED_VIRTUAL_UD_CATCH_ALL = '\0virtual:ud:catch-all'

const GRAPHQL_METHODS = ['GET', 'POST', 'OPTIONS'] as const

/**
 * Normalises the API root path so it always starts and ends with `/`.
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
 * Discovers Cedar API function source files and derives the production route
 * manifest from them. The manifest is the single source of truth for both
 * Cedar's backend routing and UD store registration.
 */
function discoverCedarRoutes(): CedarRouteRecord[] {
  const srcFunctions = getPaths().api.functions
  const distFunctions = path.join(getPaths().api.base, 'dist', 'functions')

  const sourceFiles = findApiServerFunctions(srcFunctions)

  const routes: CedarRouteRecord[] = []

  for (const sourcePath of sourceFiles) {
    const relative = path.relative(srcFunctions, sourcePath)
    const { dir, name, ext } = path.parse(relative)

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

    const routePath = routeName === 'graphql' ? '/graphql' : `/${routeName}`
    const methods = routeName === 'graphql' ? [...GRAPHQL_METHODS] : []
    const type: CedarRouteRecord['type'] =
      routeName === 'graphql'
        ? 'graphql'
        : routeName === 'health'
          ? 'health'
          : routeName.toLowerCase().includes('auth')
            ? 'auth'
            : 'function'

    const distPath = path.join(distFunctions, relative).replace(ext, '.js')

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

export function cedarUniversalDeployPlugin(
  options: CedarUniversalDeployPluginOptions = {},
): Plugin {
  const { apiRootPath, webFallback = false } = options
  const normalizedApiRootPath = normalizeApiRootPath(apiRootPath ?? '/')
  const routes = discoverCedarRoutes()

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

        // Register per-route API entries so UD adapters can split on
        // individual functions (e.g. Cloudflare Workers).
        for (const route of routes) {
          addEntry(toEntryMeta(route))
        }

        // Register a web-side SPA fallback entry for providers that need it.
        if (webFallback) {
          addEntry({
            id: VIRTUAL_CEDAR_WEB,
            route: '/**',
            method: 'GET',
          })
        }

        // Register the catch-all entry consumed by @universal-deploy/node/serve.
        addEntry({
          id: catchAllEntry,
          route: '/**',
        })
      },
    },

    resolveId(id) {
      if (id === catchAllEntry) {
        return RESOLVED_VIRTUAL_UD_CATCH_ALL
      }

      if (id === VIRTUAL_CEDAR_WEB) {
        return RESOLVED_VIRTUAL_CEDAR_WEB
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

      // Web fallback virtual module
      if (id === RESOLVED_VIRTUAL_CEDAR_WEB) {
        return generateWebFallbackModule()
      }

      // Multi-route catch-all dispatcher
      if (id === RESOLVED_VIRTUAL_UD_CATCH_ALL) {
        return generateCatchAllModule(routes, normalizedApiRootPath)
      }

      return undefined
    },
  }
}

function generateGraphQLModule(distPath: string): string {
  return `
import { buildCedarContext, requestToLegacyEvent } from '@cedarjs/api/runtime';
import { createGraphQLYoga } from '@cedarjs/graphql-server';
import { pathToFileURL } from 'node:url';

const distPath = ${JSON.stringify(distPath)};

let yogaInstance = null;
let graphqlOptions = null;

async function getYoga() {
  if (yogaInstance) return yogaInstance;
  const mod = await import(pathToFileURL(distPath).href);
  graphqlOptions = mod.__rw_graphqlOptions;
  const { yoga } = await createGraphQLYoga(mod.__rw_graphqlOptions);
  yogaInstance = yoga;
  return yoga;
}

export default {
  async fetch(request) {
    const yoga = await getYoga();
    const cedarContext = await buildCedarContext(request, {
      authDecoder: graphqlOptions?.authDecoder,
    });
    const event = await requestToLegacyEvent(request, cedarContext);
    return yoga.handle(request, {
      request,
      cedarContext,
      event,
      requestContext: undefined,
    });
  }
};
`
}

function generateFunctionModule(distPath: string): string {
  return `
import { createCedarFetchable } from '@cedarjs/api-server/udFetchable';
import { pathToFileURL } from 'node:url';

const distPath = ${JSON.stringify(distPath)};

async function handleRequest(request, ctx) {
  const mod = await import(pathToFileURL(distPath).href);
  const handler = mod.handleRequest || (mod.default && mod.default.handleRequest);
  if (!handler) {
    throw new Error(
      'Fetch-native handler not found in ' + distPath +
      '. Expected \`export async function handleRequest(request, ctx)\` ' +
      'or \`export default { handleRequest }\`.'
    );
  }
  return handler(request, ctx);
}

export default createCedarFetchable(handleRequest);
`
}

function generateWebFallbackModule(): string {
  return `
import fs from 'node:fs';
import path from 'node:path';
import { getPaths } from '@cedarjs/project-config';

const indexHtmlPath = path.join(getPaths().web.dist, 'index.html');

export default {
  async fetch() {
    try {
      const body = fs.readFileSync(indexHtmlPath, 'utf-8');
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
};
`
}

function generateCatchAllModule(
  routes: CedarRouteRecord[],
  normalizedApiRootPath: string,
): string {
  const imports = routes
    .map(
      (route, i) =>
        `import mod${i} from '${VIRTUAL_CEDAR_FN_PREFIX}${route.id}';`,
    )
    .join('\n')

  const routerSetup = routes
    .flatMap((route, i) => {
      const methods =
        route.methods.length > 0
          ? route.methods
          : ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']

      return methods.flatMap((method) => [
        `addRoute(router, '${method}', '${route.path}', mod${i});`,
        `addRoute(router, '${method}', '${route.path}/**', mod${i});`,
      ])
    })
    .join('\n')

  return `
import { createRouter, addRoute, findRoute } from 'rou3';
${imports}

const router = createRouter();
${routerSetup}

function normalizePathname(requestUrl) {
  const url = new URL(requestUrl);
  let pathname = url.pathname;
  const apiRootPath = ${JSON.stringify(normalizedApiRootPath)};
  if (apiRootPath !== '/' && pathname.startsWith(apiRootPath)) {
    pathname = pathname.slice(apiRootPath.length - 1);
  }
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }
  return pathname;
}

export default {
  async fetch(request) {
    const pathname = normalizePathname(request.url);
    const match = findRoute(router, request.method, pathname);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }
    return match.data.fetch(request);
  }
};
`
}
