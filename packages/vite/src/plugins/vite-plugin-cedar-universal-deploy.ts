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
 *
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
  // This couples directly to @universal-deploy/store internals (the symbol key
  // and the { entries: { id?: string }[] } shape are not part of that library's
  // public API). If the library ever renames its symbol or changes the entry
  // shape, clearCedarEntries will silently become a no-op. The proper fix is to
  // eliminate the need for clearing entirely, see
  // docs/implementation-plans/universal-deploy-serve-refactoring.md which
  // proposes merging buildCedarApp and buildUDApiServer into a single
  // build step, removing the cross-build-step entry accumulation issue.
  // TODO: Remove the need for this
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
  // CEDAR_API_ROOT_PATH is set by buildHandler when the --apiRootPath CLI flag
  // is passed. It takes precedence over the option value in the user's Vite
  // config so CI/deploy can override without editing tracked files
  const effectiveApiRootPath =
    process.env.CEDAR_API_ROOT_PATH ?? options.apiRootPath
  const routes = discoverCedarRoutes(effectiveApiRootPath ?? '/')

  let entriesInjected = false

  return {
    name: 'cedar-universal-deploy',
    apply: 'build',

    config: {
      order: 'pre',
      handler(_config, env) {
        // Only register routes for SSR builds. During client builds the
        // emitted chunks would reference paths that don't exist (e.g.
        // new URL("./../functions/...")), causing Rollup resolution errors.
        if (!env.isSsrBuild) {
          return
        }

        if (entriesInjected) {
          return
        }

        entriesInjected = true

        // Clear any stale Cedar entries from previous build steps (e.g. the web
        // client build, which may use a different apiRootPath).
        clearCedarEntries()

        // Register per-route API entries so UD adapters can split on
        // individual functions (e.g. Cloudflare Workers).
        for (const route of routes) {
          addEntry(toEntryMeta(route))
        }
      },
    },

    buildStart() {
      // Skip during client builds — the emitted chunks reference Node.js
      // builtins and paths that only exist during SSR builds.
      if (this.environment?.name !== 'ssr') {
        return
      }

      // Emit each per-function virtual module as a chunk with a fixed output
      // path. This guarantees import.meta.url resolves from a predictable
      // location regardless of whether @universal-deploy/vite's catchAll()
      // uses static or dynamic imports.
      for (const route of routes) {
        const resolvedId = RESOLVED_CEDAR_FN_PREFIX + route.id
        const safeName = route.id
          .replace(/[/\\?%*:|"<>]/g, '_')
          .replace(/^_+/, '')
        this.emitFile({
          type: 'chunk',
          id: resolvedId,
          // Emit the functions into a sub-dir to "hide" them from Netlify
          fileName: 'chunks/' + safeName + '-handler.js',
        })
      }
    },

    resolveId(id) {
      // Skip during client builds — the virtual modules reference Node.js
      // APIs and paths that only work in an SSR context.
      if (this.environment?.name !== 'ssr') {
        return undefined
      }

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

    async load(id) {
      // Skip during client builds.
      if (this.environment?.name !== 'ssr') {
        return undefined
      }

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

/**
 * Bundle a compiled api/dist/functions file into a self-contained ESM string
 * using esbuild. All relative/local imports are inlined; node_modules remain
 * external (nft handles those at deploy time).
 *
 * The trailing `export { ... }` block that esbuild appends is stripped so the
 * output can be safely embedded as a fragment inside a larger virtual module
 * without polluting that module's own exports. After stripping, all exported
 * names become plain `var`/`function` declarations that the surrounding wrapper
 * code can reference directly.
 *
 * Keeping node_modules external means the bundle stays small and avoids
 * duplicating large deps (graphql-server, yoga, etc.) that are already present
 * in the Lambda's node_modules.
 */
async function bundleDistFile(distPath: string): Promise<string> {
  const { build } = await import('esbuild')

  const result = await build({
    entryPoints: [distPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    packages: 'external',
    logLevel: 'silent',
  })

  // Process the trailing `export { name1, name2, X as default };` block that
  // esbuild appends for ESM format. We embed the output as an inline fragment,
  // so most exported bindings become plain local variables. However, we
  // preserve the `default` export by transforming `X as default` into a local
  // `const __cedar_default = X` declaration so wrapper code can detect a
  // plain default-exported function.
  let text = result.outputFiles[0].text

  const exportBlock = text.match(/\nexport\s*\{([^}]*)\};\s*$/)
  if (exportBlock) {
    const defaultExportMatch = exportBlock[1].match(
      /(?:^|,)\s*(\w+)\s+as\s+default\s*(?:,|$)/,
    )
    if (defaultExportMatch) {
      const defaultBinding = defaultExportMatch[1]
      text =
        text.replace(/\nexport\s*\{[^}]*\};\s*$/, '') +
        `\nconst __cedar_default = ${defaultBinding};`
    } else {
      text = text.replace(/\nexport\s*\{[^}]*\};\s*$/, '')
    }
  }

  return text
}

async function generateGraphQLModule(distPath: string): Promise<string> {
  // Bundle the compiled graphql function file so that all relative imports
  // (sdls, services, directives, etc.) are inlined. node_modules dependencies
  // (yoga, graphql-server, prisma, etc.) stay external — Netlify's nft traces
  // those normally from the deployed node_modules.
  //
  // This approach avoids every cross-file import problem:
  //   - No import.meta.url relative paths that break when nft inlines modules
  //   - No dynamic import() strings that nft can't trace
  //   - No build-time Rollup resolution of files that don't exist yet
  //
  // The __rw_graphqlOptions export from the bundled code is used directly
  // by createGraphQLYoga, so we can initialise yoga synchronously from the
  // inline bundle rather than going through a separate file import.
  const bundledCode = await bundleDistFile(distPath)

  return `
    import { buildCedarContext, requestToLegacyEvent } from '@cedarjs/api/runtime';
    import { createGraphQLYoga } from '@cedarjs/graphql-server';

    // Inlined bundle of ${path.basename(distPath)} (node_modules kept external)
    ${bundledCode}

    let yogaInitPromise = null;

    function getYoga() {
      if (!yogaInitPromise) {
        yogaInitPromise = createGraphQLYoga(__rw_graphqlOptions).then(
          ({ yoga }) => ({ yoga, graphqlOptions: __rw_graphqlOptions })
        );
      }
      return yogaInitPromise;
    }

    export default {
      async fetch(request) {
        const { yoga, graphqlOptions } = await getYoga();
        const cedarContext = await buildCedarContext(request, {
          authDecoder: graphqlOptions ? graphqlOptions.authDecoder : undefined,
        });
        const event = await requestToLegacyEvent(request, cedarContext);
        return yoga.handle(request, { request, cedarContext, event, requestContext: undefined });
      }
    };
  `
}

async function generateFunctionModule(distPath: string): Promise<string> {
  // Bundle the compiled function file so all relative imports are inlined.
  // See generateGraphQLModule for a full explanation.
  const bundledCode = await bundleDistFile(distPath)

  const notFoundMsg = JSON.stringify(
    `Handler not found in ${path.basename(distPath)}. Expected ` +
      '`export async function handleRequest(request, ctx)`, ' +
      '`export default async (request, ctx) => Response`, ' +
      '`export default { handleRequest }`, ' +
      'or a legacy Lambda-shaped `handler`.',
  )

  return `
    import { wrapLegacyHandler, buildCedarContext } from '@cedarjs/api/runtime';

    // Inlined bundle of ${path.basename(distPath)} (node_modules kept external)
    ${bundledCode}

    const nativeHandler = (() => {
      // Prefer named handleRequest export
      if (typeof handleRequest !== 'undefined') { return handleRequest; }
      // Handle export default { handleRequest } pattern
      if (typeof __cedar_default !== 'undefined' && __cedar_default && typeof __cedar_default.handleRequest === 'function') {
        return __cedar_default.handleRequest;
      }
      // Handle plain default-exported async function: export default async (req) => Response
      if (typeof __cedar_default !== 'undefined' && typeof __cedar_default === 'function') {
        return __cedar_default;
      }
      return undefined;
    })();

    const legacyFn = (() => {
      if (typeof handler !== 'undefined') { return handler; }
      if (typeof __cedar_default !== 'undefined' && __cedar_default && typeof __cedar_default.handler === 'function') {
        return __cedar_default.handler;
      }
      return undefined;
    })();

    if (!nativeHandler && !legacyFn) {
      throw new Error(${notFoundMsg});
    }

    const _handler = nativeHandler ?? wrapLegacyHandler(legacyFn);

    export default {
      async fetch(request) {
        const ctx = await buildCedarContext(request);
        return _handler(request, ctx);
      }
    };
  `
}
