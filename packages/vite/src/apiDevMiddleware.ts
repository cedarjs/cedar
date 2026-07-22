import fs from 'node:fs'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ansis from 'ansis'
import type { Handler } from 'aws-lambda'
import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import { normalizePath } from 'vite'
import type { ModuleNode, Plugin, ViteDevServer } from 'vite'
import { gqlPlugin as gqlTagPlugin } from 'vite-plugin-graphql-tag'
import tsPathsMod from 'vite-tsconfig-paths'

// vite-tsconfig-paths is ESM-only. CJS builds double-wrap its default
// export: tsconfigPaths.default is the module object, and
// tsconfigPaths.default.default is the actual function. ESM gets the
// function directly. The `||` chain resolves correctly for both.
const tsconfigPaths =
  // @ts-expect-error – .default only exists at runtime in CJS double-wrap
  // interop
  tsPathsMod.default?.default || tsPathsMod.default || tsPathsMod

import { buildCedarContext, wrapLegacyHandler } from '@cedarjs/api/runtime'
import type { CedarHandler, LegacyHandler } from '@cedarjs/api/runtime'
import {
  getApiSideBabelConfigPath,
  getApiSideBabelPluginsForVite,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { applyGqlormInject } from '@cedarjs/internal/dist/build/api-graphql-transforms.js'
import { getConfig, getPaths } from '@cedarjs/project-config'

import { getWorkspacePackageAliases } from './lib/workspacePackageAliases.js'
import { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
import { cedarDirectoryNamedImportPlugin } from './plugins/vite-plugin-cedar-directory-named-import.js'
import { applyGraphqlOptionsExtract } from './plugins/vite-plugin-cedar-graphql-options-extract.js'
import { cedarImportDirPlugin } from './plugins/vite-plugin-cedar-import-dir.js'
import { cedarApiLogFormatterDevPlugin } from './plugins/vite-plugin-cedar-log-formatter-dev.js'
import { applyOtelWrapping } from './plugins/vite-plugin-cedar-otel-wrapping.js'
import { cedarjsJobPathInjectorPlugin } from './plugins/vite-plugin-cedarjs-job-path-injector.js'

function resolveWithExtensions(id: string): string {
  // A bare `fs.existsSync(id)` also returns true for directories (e.g. a
  // directory-named-import target). Since this plugin's resolveId return
  // short-circuits Vite's resolveId chain, that would incorrectly claim the
  // bare directory path as fully resolved instead of letting a later plugin
  // (e.g. one resolving directory-named imports) handle it.
  if (fs.existsSync(id) && fs.statSync(id).isFile()) {
    return id
  }
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts']) {
    const withExt = id + ext
    if (fs.existsSync(withExt)) {
      return withExt
    }
  }
  return id
}

const LAMBDA_FUNCTIONS: Record<string, CedarHandler> = {}

interface YogaInstance {
  handle(request: Request, context: Record<string, unknown>): Promise<Response>
  graphqlEndpoint: string
}

let graphqlYoga: YogaInstance | null = null

let loadApiFunctionsInFlight: Promise<void> | null = null
let needsReloadAfterInFlight = false

export async function loadApiFunctions(viteServer: ViteDevServer) {
  if (loadApiFunctionsInFlight) {
    needsReloadAfterInFlight = true
    return
  }

  do {
    needsReloadAfterInFlight = false
    loadApiFunctionsInFlight = internalLoadApiFunctions(viteServer)
    try {
      await loadApiFunctionsInFlight
    } finally {
      loadApiFunctionsInFlight = null
    }
  } while (needsReloadAfterInFlight)
}

async function internalLoadApiFunctions(viteServer: ViteDevServer) {
  const cedarPaths = getPaths()

  for (const key of Object.keys(LAMBDA_FUNCTIONS)) {
    delete LAMBDA_FUNCTIONS[key]
  }

  let srcFunctions: string[] = []

  try {
    srcFunctions = await Array.fromAsync(
      glob('**/*.{ts,tsx,js,jsx}', {
        cwd: cedarPaths.api.functions,
        exclude: [
          '**/*.test.{ts,tsx,js,jsx}',
          '**/*.scenarios.{ts,tsx,js,jsx}',
          '**/*.fixtures.{ts,tsx,js,jsx}',
          '**/*.d.ts',
        ],
      }),
      (entry) => path.join(cedarPaths.api.functions, entry),
    )
  } catch {
    srcFunctions = []
  }

  console.log(ansis.dim.italic('Importing Server Functions... '))
  const tsImport = Date.now()

  let extractedGraphqlOptions: GraphQLYogaOptions | null = null

  const imports = srcFunctions.map(async (fnPath) => {
    const ts = Date.now()
    const routeName = path.basename(fnPath).replace(/\.(ts|tsx|js|jsx)$/, '')

    try {
      const mod = await viteServer.ssrLoadModule(pathToFileURL(fnPath).href)

      const cedarHandler: CedarHandler | undefined = (() => {
        // Prefer the new Fetch-native handleRequest shape.
        if ('handleRequest' in mod) {
          return mod.handleRequest as CedarHandler
        }

        if ('default' in mod && mod.default && 'handleRequest' in mod.default) {
          return mod.default.handleRequest as CedarHandler
        }

        // Fall back to the legacy Lambda-shaped handler and wrap it.
        let legacyHandler: Handler | undefined

        if ('handler' in mod) {
          legacyHandler = mod.handler as Handler
        } else if (
          'default' in mod &&
          mod.default &&
          'handler' in mod.default
        ) {
          legacyHandler = mod.default.handler as Handler
        }

        if (legacyHandler) {
          return wrapLegacyHandler(legacyHandler as LegacyHandler)
        }

        return undefined
      })()

      if (cedarHandler) {
        LAMBDA_FUNCTIONS[routeName] = cedarHandler
        console.log(
          ansis.magenta('/' + routeName),
          ansis.dim.italic(Date.now() - ts + ' ms'),
        )
      } else {
        console.warn(
          `[apiDevMiddleware] No handler or handleRequest export found in function: ${fnPath}`,
        )
      }

      if (routeName === 'graphql' && '__cedar_graphqlOptions' in mod) {
        extractedGraphqlOptions =
          mod.__cedar_graphqlOptions as GraphQLYogaOptions
      }
    } catch (err) {
      viteServer.ssrFixStacktrace(err as Error)
      console.error(
        `[apiDevMiddleware] Failed to load function "${routeName}" from ${fnPath}:`,
        err,
      )
    }
  })

  await Promise.all(imports)

  if (extractedGraphqlOptions) {
    const { yoga } = await createGraphQLYoga(extractedGraphqlOptions)
    graphqlYoga = yoga
  } else {
    // Reset so deleted/missing graphql.ts is reflected immediately (i.e. during
    // a dev session)
    graphqlYoga = null
  }

  console.log(
    ansis.dim.italic('...Done importing in ' + (Date.now() - tsImport) + ' ms'),
  )
}

export async function createApiViteServer(): Promise<ViteDevServer> {
  const cedarPaths = getPaths()
  const cedarConfig = getConfig()
  const normalizedBase = normalizePath(cedarPaths.base)

  // The Babel pass is only needed to apply a user's custom
  // api/babel.config.js: getApiSideBabelPluginsForVite() is empty (all of
  // Cedar's api-side Babel transforms are handled by dedicated Vite plugins
  // in this pipeline) and Vite strips TypeScript itself. Skip Babel entirely
  // when the project has no such config file.
  const babelPlugins = getApiSideBabelConfigPath()
    ? getApiSideBabelPluginsForVite()
    : null

  const workspacePkgSourceMap = Object.fromEntries(
    Object.entries(getWorkspacePackageAliases(cedarPaths, cedarConfig)).map(
      ([name, sourceFile]) => [name, normalizePath(sourceFile)],
    ),
  )

  const { createServer: createViteServer } = await import('vite')

  return createViteServer({
    configFile: false,
    root: cedarPaths.api.base,
    appType: 'custom',
    clearScreen: false,
    logLevel: 'warn',
    server: {
      middlewareMode: true,
    },
    resolve: {
      alias: workspacePkgSourceMap,
    },
    plugins: [
      // tsconfigPaths resolves user-defined tsconfig.json `paths` aliases; it
      // replaces the Babel module-resolver's tsconfig-paths handling for dev.
      tsconfigPaths(),
      cedarApiLogFormatterDevPlugin(),
      {
        name: 'cedar-api-src-redirect',
        enforce: 'pre',
        resolveId(id: string, importer: string | undefined) {
          // Normalize both sides: on Windows, cedarPaths.api.src can contain
          // backslashes while Vite supplies forward-slash importer ids, so a
          // raw startsWith would never match. The trailing separator guards
          // against matching an adjacent directory (e.g. `api/src-extra`).
          const normalizedImporter = importer && normalizePath(importer)
          const normalizedApiSrc = normalizePath(cedarPaths.api.src)

          if (!normalizedImporter?.startsWith(`${normalizedApiSrc}/`)) {
            return null
          }

          if (id.startsWith('src/')) {
            return resolveWithExtensions(
              path.join(cedarPaths.api.src, id.slice(4)),
            )
          }

          return null
        },
      },
      cedarImportDirPlugin(),
      cedarDirectoryNamedImportPlugin(),
      cedarAutoImportsPlugin(),
      cedarjsJobPathInjectorPlugin(),
      (() => {
        const p = gqlTagPlugin() as Plugin
        p.enforce = 'post'
        return p
      })(),
      {
        name: 'cedar-api-babel-transform',
        enforce: 'pre',
        async transform(code, id) {
          if (!/\.(ts|tsx|js|jsx)$/.test(id)) {
            return null
          }

          if (id.includes('node_modules')) {
            return null
          }

          if (!id.startsWith(normalizedBase)) {
            return null
          }

          try {
            // Apply graphql-specific and OTel transforms BEFORE Babel CJS
            // compilation. These transforms use AST patterns that match ESM
            // syntax; running them first ensures they always work regardless
            // of the project's module format.
            let sourceCode = code
            // Exact sourcemap for the string transforms applied so far. Only
            // the graphql options extract produces one; if a later transform
            // changes the code again the map no longer matches and is
            // cleared.
            let sourceMap: SourceMap | null = null
            if (
              normalizePath(id).endsWith('/graphql.ts') ||
              normalizePath(id).endsWith('/graphql.js')
            ) {
              const extracted = applyGraphqlOptionsExtract(sourceCode)
              if (extracted) {
                sourceCode = extracted.code
                sourceMap = extracted.map
              }

              const injected = applyGqlormInject(sourceCode, id)
              if (injected) {
                sourceCode = injected
                sourceMap = null
              }
            }

            if (
              cedarConfig.experimental?.opentelemetry?.enabled &&
              cedarConfig.experimental?.opentelemetry?.wrapApi
            ) {
              const relativePath = normalizePath(id).slice(
                normalizedBase.length + '/api/src/'.length,
              )
              const apiFolder = relativePath.split('/')[0] ?? '?'
              const wrapped = applyOtelWrapping(sourceCode, id, apiFolder)
              if (wrapped) {
                sourceCode = wrapped
                sourceMap = null
              }
            }

            // Without a user Babel config there is nothing left for Babel to
            // do — Vite's own pipeline strips TypeScript — so only return the
            // string-transformed code (if it changed at all). When no exact
            // map is available, fall back to a high-resolution identity map
            // over the input so the sourcemap chain stays intact.
            if (!babelPlugins) {
              if (sourceCode === code) {
                return null
              }

              return {
                code: sourceCode,
                map:
                  sourceMap ??
                  new MagicString(code).generateMap({ hires: true }),
              }
            }

            // Use the code Vite already loaded instead of reading from disk, so
            // Vite's originalCode matches the Babel input. This ensures the SSR
            // transform's sourcesContent is consistent with the map.
            const result = await transformWithBabel(
              sourceCode,
              id,
              babelPlugins,
              true,
              true,
            )

            if (!result?.code) {
              return null
            }

            return {
              code: result.code,
              map: result.map ?? null,
            }
          } catch (err) {
            this.warn(
              `[cedar-api-babel-transform] Failed to transform ${id}: ${String(err)}`,
            )

            return null
          }
        },
      },
    ],
  })
}

function invalidateApiModules(
  viteServer: ViteDevServer,
  normalizedApiSrc: string,
): void {
  const invalidated = new Set<string>()

  const invalidateWithImporters = (mod: ModuleNode) => {
    if (!mod || invalidated.has(mod.id ?? mod.url)) {
      return
    }
    invalidated.add(mod.id ?? mod.url)
    viteServer.moduleGraph.invalidateModule(mod)
    for (const importer of mod.importers) {
      invalidateWithImporters(importer)
    }
  }

  for (const mod of viteServer.moduleGraph.idToModuleMap.values()) {
    if (mod.id?.startsWith(normalizedApiSrc)) {
      invalidateWithImporters(mod)
    }
  }
}

export function setupHmrHandlers(viteServer: ViteDevServer): void {
  const cedarPaths = getPaths()
  const normalizedApiSrc = normalizePath(cedarPaths.api.src)
  const normalizedApiBase = normalizePath(cedarPaths.api.base)

  viteServer.watcher.on('change', async (filePath) => {
    const normalizedFilePath = normalizePath(filePath)

    if (!normalizedFilePath.startsWith(normalizedApiSrc)) {
      return
    }

    const displayPath = path.relative(normalizedApiBase, normalizedFilePath)
    console.log(ansis.dim(`[change] ${displayPath}`))

    const fileUrl = pathToFileURL(normalizedFilePath).href
    const mod =
      viteServer.moduleGraph.getModuleById(normalizedFilePath) ??
      viteServer.moduleGraph.getModuleById(fileUrl)

    if (mod) {
      const invalidated = new Set<string>()
      const invalidateWithImporters = (m: typeof mod) => {
        if (!m || invalidated.has(m.id ?? m.url)) {
          return
        }

        invalidated.add(m.id ?? m.url)
        viteServer.moduleGraph.invalidateModule(m)

        for (const importer of m.importers) {
          invalidateWithImporters(importer)
        }
      }

      invalidateWithImporters(mod)
    }

    await loadApiFunctions(viteServer)
  })

  viteServer.watcher.on('add', async (filePath) => {
    const normalizedFilePath = normalizePath(filePath)

    if (!normalizedFilePath.startsWith(normalizedApiSrc)) {
      return
    }

    console.log(
      ansis.dim(
        `[add] ${path.relative(normalizedApiBase, normalizedFilePath)}`,
      ),
    )

    invalidateApiModules(viteServer, normalizedApiSrc)
    await loadApiFunctions(viteServer)
  })

  viteServer.watcher.on('unlink', async (filePath) => {
    const normalizedFilePath = normalizePath(filePath)

    if (!normalizedFilePath.startsWith(normalizedApiSrc)) {
      return
    }

    console.log(
      ansis.dim(
        `[unlink] ${path.relative(normalizedApiBase, normalizedFilePath)}`,
      ),
    )

    invalidateApiModules(viteServer, normalizedApiSrc)
    await loadApiFunctions(viteServer)
  })
}

/**
 * Creates a fetch-native handler for API requests.
 * Routes GraphQL to Yoga and Lambda functions to their handlers.
 */
export function createApiFetchHandler() {
  const cedarConfig = getConfig()
  const apiUrlPrefix = cedarConfig.web.apiUrl.replace(/\/$/, '')

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    let pathname = url.pathname

    // Strip the configured apiUrl prefix so that route matching works
    // regardless of whether the request came through the proxy or directly.
    if (pathname.startsWith(apiUrlPrefix + '/')) {
      pathname = pathname.slice(apiUrlPrefix.length)
    } else if (pathname === apiUrlPrefix) {
      pathname = '/'
    }

    // GraphQL routes
    if (pathname === '/graphql' || pathname.startsWith('/graphql/')) {
      if (!graphqlYoga) {
        return new Response(
          JSON.stringify({ error: 'GraphQL Yoga instance not initialized' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const yoga = graphqlYoga

      return getAsyncStoreInstance().run(new Map(), async () => {
        try {
          return await yoga.handle(request, { request })
        } catch (e) {
          if (
            !!e &&
            typeof e === 'object' &&
            'code' in e &&
            e.code === 'ERR_STREAM_PREMATURE_CLOSE'
          ) {
            // Client disconnected while the request was being processed
            // (e.g., page navigation, tab close). Return a 499 so the
            // dev server doesn't log this as a 500.
            return new Response(null, { status: 499 })
          }

          throw e
        }
      })
    }

    // Extract route name from /:routeName or /:routeName/*
    const match = pathname.match(/^\/([^/]+)(?:\/.*)?$/)
    if (!match) {
      return new Response('Not Found', { status: 404 })
    }

    const routeName = match[1]
    const handler = LAMBDA_FUNCTIONS[routeName]

    if (!handler) {
      return new Response(
        JSON.stringify({
          error: `Function "${routeName}" was not found.`,
          availableFunctions: Object.keys(LAMBDA_FUNCTIONS),
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const ctx = await buildCedarContext(request, {
        params: { routeName },
      })

      // LAMBDA_FUNCTIONS stores CedarHandlers directly (either native
      // handleRequest or already-wrapped legacy handlers).
      return await handler(request, ctx)
    } catch (err) {
      console.error(
        `[apiDevMiddleware] Error handling function "${routeName}":`,
        err,
      )
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Internal Server Error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }
}

export async function startApiDevMiddleware(): Promise<{
  viteServer: ViteDevServer
  close: () => Promise<void>
  handler: (request: Request) => Promise<Response>
}> {
  const viteServer = await createApiViteServer()

  console.log(ansis.dim.italic('Starting API dev server...'))
  await loadApiFunctions(viteServer)
  setupHmrHandlers(viteServer)

  const close = async () => {
    await viteServer.close()
  }

  const handler = createApiFetchHandler()

  return { viteServer, close, handler }
}
