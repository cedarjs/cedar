import { glob } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ansis from 'ansis'
import type { Handler } from 'aws-lambda'
import { normalizePath } from 'vite'
import type { ModuleNode, ViteDevServer } from 'vite'

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'
import { buildCedarContext, wrapLegacyHandler } from '@cedarjs/api/runtime'
import type { LegacyHandler } from '@cedarjs/api/runtime'

import { getWorkspacePackageAliases } from './lib/workspacePackageAliases.js'

const LAMBDA_FUNCTIONS: Record<string, Handler> = {}

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

  const graphqlFunctionIndex = srcFunctions.findIndex((f) =>
    path.basename(f).startsWith('graphql.'),
  )
  if (graphqlFunctionIndex > 0) {
    const [graphqlFn] = srcFunctions.splice(graphqlFunctionIndex, 1)
    srcFunctions.unshift(graphqlFn)
  }

  console.log(ansis.dim.italic('Importing Server Functions... '))
  const tsImport = Date.now()

  let extractedGraphqlOptions: GraphQLYogaOptions | null = null

  const imports = srcFunctions.map(async (fnPath) => {
    const ts = Date.now()
    const routeName = path.basename(fnPath).replace(/\.(ts|tsx|js|jsx)$/, '')

    try {
      const mod = await viteServer.ssrLoadModule(pathToFileURL(fnPath).href)

      const handler: Handler | undefined = (() => {
        if ('handler' in mod) {
          return mod.handler as Handler
        }
        if ('default' in mod && mod.default && 'handler' in mod.default) {
          return mod.default.handler as Handler
        }
        return undefined
      })()

      if (handler) {
        LAMBDA_FUNCTIONS[routeName] = handler
        console.log(
          ansis.magenta('/' + routeName),
          ansis.dim.italic(Date.now() - ts + ' ms'),
        )
      } else {
        console.warn(
          `[apiDevMiddleware] No handler export found in function: ${fnPath}`,
        )
      }

      if (routeName === 'graphql' && '__rw_graphqlOptions' in mod) {
        extractedGraphqlOptions = mod.__rw_graphqlOptions as GraphQLYogaOptions
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
  }

  console.log(
    ansis.dim.italic('...Done importing in ' + (Date.now() - tsImport) + ' ms'),
  )
}

export async function createApiViteServer(): Promise<ViteDevServer> {
  const cedarPaths = getPaths()
  const cedarConfig = getConfig()
  const isEsm = projectSideIsEsm('api')
  const normalizedBase = normalizePath(cedarPaths.base)

  const babelPlugins = getApiSideBabelPlugins({
    openTelemetry:
      (cedarConfig.experimental?.opentelemetry?.enabled ?? false) &&
      (cedarConfig.experimental?.opentelemetry?.wrapApi ?? false),
    projectIsEsm: isEsm,
  })

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
      {
        name: 'cedar-api-babel-transform',
        async transform(_code, id) {
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
            const result = await transformWithBabel(id, babelPlugins)

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
        return yoga.handle(request, { request })
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

      // Wrap the legacy Lambda handler into a fetch-native CedarHandler
      const cedarHandler = wrapLegacyHandler(handler as LegacyHandler)
      return await cedarHandler(request, ctx)
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
