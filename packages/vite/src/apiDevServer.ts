import { glob } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import fastifyUrlData from '@fastify/url-data'
import ansis from 'ansis'
import type { Handler } from 'aws-lambda'
import fastify from 'fastify'
import type {
  FastifyReply,
  FastifyRequest,
  RequestGenericInterface,
} from 'fastify'
import fastifyRawBody from 'fastify-raw-body'
import { createServer as createViteServer, normalizePath } from 'vite'
import type { ModuleNode, ViteDevServer } from 'vite'

import { requestHandler } from '@cedarjs/api-server/requestHandlers'
import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import { getWorkspacePackageAliases } from './lib/workspacePackageAliases.js'

// This const acts as a module registry. It is populated on startup and
// refreshed on HMR invalidation
const LAMBDA_FUNCTIONS: Record<string, Handler> = {}

interface YogaInstance {
  handle(request: Request, context: Record<string, unknown>): Promise<Response>
  graphqlEndpoint: string
}

let graphqlYoga: YogaInstance | null = null

// In-flight guard to prevent concurrent executions of loadApiFunctions from
// corrupting the LAMBDA_FUNCTIONS registry when multiple file-change events
// fire in quick succession (e.g. codegen, scaffold, git checkout).
let loadApiFunctionsInFlight: Promise<void> | null = null
let needsReloadAfterInFlight = false

interface LambdaHandlerRequest extends RequestGenericInterface {
  Params: {
    routeName: string
  }
}

/**
 * Discover all function source files under api/src/functions/ and load them
 * through Vite's SSR module runner so that the Babel transforms are applied
 * and HMR invalidation works correctly.
 *
 * This function is wrapped with an in-flight guard so that rapid file-change
 * events don't trigger overlapping reloads that could leave the function
 * registry empty or corrupted.
 */
async function loadApiFunctions(viteServer: ViteDevServer) {
  if (loadApiFunctionsInFlight) {
    needsReloadAfterInFlight = true
    return
  }

  do {
    needsReloadAfterInFlight = false
    loadApiFunctionsInFlight = internalLoadApiFunctions(viteServer)
    await loadApiFunctionsInFlight
    loadApiFunctionsInFlight = null
  } while (needsReloadAfterInFlight)
}

async function internalLoadApiFunctions(viteServer: ViteDevServer) {
  const cedarPaths = getPaths()

  // Clear the registry before reloading
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
    // functions directory may not exist yet
    srcFunctions = []
  }

  // Load graphql first so it is registered before other functions
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
      // Use file:// URL so Vite resolves the module correctly
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
          `[apiDevServer] No handler export found in function: ${fnPath}`,
        )
      }

      // Extract __rw_graphqlOptions from the graphql module
      if (routeName === 'graphql' && '__rw_graphqlOptions' in mod) {
        extractedGraphqlOptions = mod.__rw_graphqlOptions as GraphQLYogaOptions
      }
    } catch (err) {
      viteServer.ssrFixStacktrace(err as Error)
      console.error(
        `[apiDevServer] Failed to load function "${routeName}" from ${fnPath}:`,
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

/**
 * Convert a Fastify request to a Fetch API Request object.
 * This is needed for passing to Yoga's handle method which expects a Fetch Request.
 */
function createFetchRequestFromFastify(req: FastifyRequest): Request {
  const requestBody =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : typeof req.body === 'string'
        ? req.body
        : req.body
          ? JSON.stringify(req.body)
          : undefined

  const href = `${req.protocol}://${req.hostname}${req.raw.url ?? '/'}`
  return new Request(href, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: requestBody,
  })
}

/**
 * Start the Cedar API dev server using Vite's SSR module runner for HMR.
 *
 * This replaces the previous system of:
 *   nodemon → api-server-watch (chokidar + esbuild + forked child process)
 *
 * With:
 *   Vite SSR dev server (module graph + HMR) + Fastify (same process)
 *
 * When API source files change, Vite invalidates the affected modules and
 * re-loads them on the next call – no process restart needed.
 */
export async function startApiDevServer(port: number): Promise<{
  viteServer: ViteDevServer
  close: () => Promise<void>
}> {
  const cedarPaths = getPaths()
  const cedarConfig = getConfig()
  const apiPort = port || cedarConfig.api.port || 8911
  const apiHost = cedarConfig.api.host || '::'
  const isEsm = projectSideIsEsm('api')

  // Pre-normalise every Cedar path we compare against Vite ids so the checks
  // work both Windows and Linux/MacOS.
  const normalizedBase = normalizePath(cedarPaths.base)
  const normalizedApiSrc = normalizePath(cedarPaths.api.src)
  const normalizedApiBase = normalizePath(cedarPaths.api.base)

  const viteServer = await createViteDevServer(
    cedarPaths,
    cedarConfig,
    isEsm,
    normalizedBase,
  )

  console.log(ansis.dim.italic('Starting API dev server...'))
  await loadApiFunctions(viteServer)

  setupHmrHandlers(viteServer, normalizedApiSrc, normalizedApiBase)

  const app = await createFastifyApp(apiPort, apiHost)

  const close = async () => {
    await app.close()
    await viteServer.close()
  }

  return { viteServer, close }
}

/**
 * Create and configure the Vite SSR dev server with Babel transform plugin.
 */
async function createViteDevServer(
  cedarPaths: ReturnType<typeof getPaths>,
  cedarConfig: ReturnType<typeof getConfig>,
  projectIsEsm: boolean,
  normalizedBase: string,
): Promise<ViteDevServer> {
  const babelPlugins = getApiSideBabelPlugins({
    openTelemetry:
      (cedarConfig.experimental?.opentelemetry?.enabled ?? false) &&
      (cedarConfig.experimental?.opentelemetry?.wrapApi ?? false),
    projectIsEsm,
  })

  // Build a map of workspace package name → TypeScript source entry path.
  // Mirrors the logic in buildHandler.ts / buildPackagesTask.js and is only
  // active when experimental.packagesWorkspace.enabled = true.
  // Normalise source-file paths to forward slashes so Vite's alias plugin
  // resolves them correctly on Windows.
  const workspacePkgSourceMap = Object.fromEntries(
    Object.entries(getWorkspacePackageAliases(cedarPaths, cedarConfig)).map(
      ([name, sourceFile]) => [name, normalizePath(sourceFile)],
    ),
  )

  // - `configFile: false` so we configure everything programmatically
  // - `middlewareMode: true` + `appType: 'custom'` – no HTML serving
  // - Vite externalises node_modules in SSR mode by default, which is
  //   exactly what we want; only api/src files go through the Babel plugin
  const viteServer = await createViteServer({
    configFile: false,
    root: cedarPaths.api.base,
    appType: 'custom',
    clearScreen: false,
    logLevel: 'warn',
    server: {
      middlewareMode: true,
    },
    resolve: {
      // Map workspace package names directly to their TypeScript source entry
      // files. This is processed by Vite's built-in alias plugin (enforce:
      // 'pre') which runs before vite:resolve and correctly intercepts imports
      // in the SSR module runner context.
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

          // Vite normalises ids to forward slashes on all platforms; Cedar
          // paths may use backslashes on Windows – compare using the
          // pre-normalised forward-slash version.
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

  return viteServer
}

/**
 * Invalidate every module whose id lies inside the API source directory so
 * that `ssrLoadModule` re-executes it on the next call. This is needed when
 * files are added or removed because modules using `import.meta.glob` (e.g.
 * `graphql.js`) won't otherwise notice the new/deleted files.
 *
 * Invalidation propagates recursively to importers so that function modules
 * which import changed utilities or services are also refreshed.
 */
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

/**
 * Set up HMR handlers for the Vite SSR module runner. It watches for file
 * changes, invalidates the module graph when necessary and reloads functions
 */
function setupHmrHandlers(
  viteServer: ViteDevServer,
  normalizedApiSrc: string,
  normalizedApiBase: string,
): void {
  viteServer.watcher.on('change', async (filePath) => {
    // Vite's file watcher emits forward-slash paths on all platforms;
    // use the pre-normalised Cedar paths for comparison.
    const normalizedFilePath = normalizePath(filePath)

    if (!normalizedFilePath.startsWith(normalizedApiSrc)) {
      return
    }

    const displayPath = path.relative(normalizedApiBase, normalizedFilePath)
    console.log(ansis.dim(`[change] ${displayPath}`))

    // Invalidate so ssrLoadModule re-executes the module on the next call
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

    // New files (e.g. generated SDLs) can be picked up by existing modules
    // via import.meta.glob. Invalidate all API modules so those globs are
    // re-evaluated on the next ssrLoadModule call.
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

    // When a file is removed, invalidate all API modules so that modules
    // using import.meta.glob or dynamic imports don't keep stale references.
    invalidateApiModules(viteServer, normalizedApiSrc)
    await loadApiFunctions(viteServer)
  })
}

/**
 * Create and configure the Fastify server with all routes registered.
 * This mirrors the setup in @cedarjs/api-server's cedarFastifyAPI plugin, but
 * uses the in-process LAMBDA_FUNCTIONS registry (loaded via Vite SSR) instead
 * of importing from api/dist.
 */
async function createFastifyApp(apiPort: number, apiHost: string) {
  // Enable Fastify's built-in logger so that errors surfaced by
  // requestHandler (e.g. 500s from user functions) are visible in the
  // dev server output instead of being swallowed.
  const logLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  const app = fastify({ logger: { level: logLevel } })

  // fastify-raw-body is required by the requestHandler helper so it can
  // access the raw request body for base64 encoding / parsing
  await app.register(fastifyRawBody)
  app.register(fastifyUrlData)

  app.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    { parseAs: 'string' },
    app.defaultTextParser,
  )

  const lambdaRequestHandler = async (
    req: FastifyRequest<LambdaHandlerRequest>,
    reply: FastifyReply,
  ) => {
    const { routeName } = req.params
    const handler = LAMBDA_FUNCTIONS[routeName]

    if (!handler) {
      const errorMessage = `Function "${routeName}" was not found.`
      req.log.error(errorMessage)
      reply.status(404)

      reply.send({
        error: errorMessage,
        availableFunctions: Object.keys(LAMBDA_FUNCTIONS),
      })

      return
    }

    return requestHandler(req, reply, handler)
  }

  // GraphQL routes with streaming support via Yoga's handle method
  // These must be registered BEFORE the catch-all routes for other functions
  const graphqlHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!graphqlYoga) {
      return reply
        .status(503)
        .send({ error: 'GraphQL Yoga instance not initialized' })
    }

    const request = createFetchRequestFromFastify(req)
    const yoga = graphqlYoga

    // Mirror the lambda handler path by wrapping Yoga execution in an
    // AsyncLocalStorage context so that Cedar's global `context` proxy
    // (used by requireAuth / isAuthenticated) can read currentUser and
    // other context values set by the Redwood auth plugins.
    const response = await getAsyncStoreInstance().run(new Map(), async () => {
      return yoga.handle(request, { req, reply })
    })

    // Fastify v5 has first-class support for WHATWG Response objects
    return response
  }

  app.all('/graphql', graphqlHandler)
  app.all('/graphql/*', graphqlHandler)

  // Catch-all routes for other API functions (non-GraphQL)
  app.all('/:routeName', lambdaRequestHandler)
  app.all('/:routeName/*', lambdaRequestHandler)

  app.addHook('onListen', (done) => {
    const addr = app.server.address()
    const listenPort = addr && typeof addr === 'object' ? addr.port : apiPort

    console.log(
      `API dev server listening at ${ansis.magenta(`http://localhost:${listenPort}/`)}`,
    )
    console.log(
      `GraphQL endpoint at ${ansis.magenta(`http://localhost:${listenPort}/graphql`)}`,
    )

    done()
  })

  await app.listen({ port: apiPort, host: apiHost })

  return app
}
