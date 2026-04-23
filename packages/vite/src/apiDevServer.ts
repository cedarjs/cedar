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
import { createServer as createViteServer } from 'vite'
import type { ViteDevServer } from 'vite'

import { requestHandler } from '@cedarjs/api-server/requestHandlers'
import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

// ---------------------------------------------------------------------------
// Module registry – populated on startup and refreshed on HMR invalidation
// ---------------------------------------------------------------------------

const LAMBDA_FUNCTIONS: Record<string, Handler> = {}

interface LambdaHandlerRequest extends RequestGenericInterface {
  Params: {
    routeName: string
  }
}

/**
 * Discover all function source files under api/src/functions/ and load them
 * through Vite's SSR module runner so that the Babel transforms are applied
 * and HMR invalidation works correctly.
 */
async function loadApiFunctions(viteServer: ViteDevServer): Promise<void> {
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
  const graphqlIdx = srcFunctions.findIndex((f) =>
    path.basename(f).startsWith('graphql.'),
  )
  if (graphqlIdx > 0) {
    const [graphqlFn] = srcFunctions.splice(graphqlIdx, 1)
    srcFunctions.unshift(graphqlFn)
  }

  console.log(ansis.dim.italic('Importing Server Functions... '))
  const tsImport = Date.now()

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
    } catch (err) {
      viteServer.ssrFixStacktrace(err as Error)
      console.error(
        `[apiDevServer] Failed to load function "${routeName}" from ${fnPath}:`,
        err,
      )
    }
  })

  await Promise.all(imports)

  console.log(
    ansis.dim.italic('...Done importing in ' + (Date.now() - tsImport) + ' ms'),
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  // Build Babel plugins once; they are shared across all transform calls
  const babelPlugins = getApiSideBabelPlugins({
    openTelemetry:
      (cedarConfig.experimental?.opentelemetry?.enabled ?? false) &&
      (cedarConfig.experimental?.opentelemetry?.wrapApi ?? false),
    projectIsEsm: isEsm,
  })

  // ---------------------------------------------------------------------------
  // 1. Vite SSR dev server
  //    - `configFile: false` so we configure everything programmatically
  //    - `middlewareMode: true` + `appType: 'custom'` – no HTML serving
  //    - Vite externalises node_modules in SSR mode by default, which is
  //      exactly what we want; only api/src files go through the Babel plugin
  // ---------------------------------------------------------------------------
  const viteServer = await createViteServer({
    configFile: false,
    root: cedarPaths.api.base,
    appType: 'custom',
    clearScreen: false,
    logLevel: 'warn',
    server: {
      middlewareMode: true,
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

          if (!id.startsWith(cedarPaths.api.base)) {
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

  // ---------------------------------------------------------------------------
  // 2. Initial function load
  // ---------------------------------------------------------------------------
  console.log(ansis.dim.italic('Starting API dev server...'))
  await loadApiFunctions(viteServer)

  // ---------------------------------------------------------------------------
  // 3. HMR: watch for file changes, invalidate modules, and reload functions
  // ---------------------------------------------------------------------------
  viteServer.watcher.on('change', async (filePath) => {
    if (!filePath.startsWith(cedarPaths.api.src)) {
      return
    }

    const displayPath = path.relative(cedarPaths.api.base, filePath)
    console.log(ansis.dim(`[change] ${displayPath}`))

    // Invalidate so ssrLoadModule re-executes the module on the next call
    const fileUrl = pathToFileURL(filePath).href
    const mod =
      viteServer.moduleGraph.getModuleById(filePath) ??
      viteServer.moduleGraph.getModuleById(fileUrl)

    if (mod) {
      viteServer.moduleGraph.invalidateModule(mod)
    }

    await loadApiFunctions(viteServer)
  })

  viteServer.watcher.on('add', async (filePath) => {
    if (!filePath.startsWith(cedarPaths.api.src)) {
      return
    }

    console.log(
      ansis.dim(`[add] ${path.relative(cedarPaths.api.base, filePath)}`),
    )
    await loadApiFunctions(viteServer)
  })

  viteServer.watcher.on('unlink', async (filePath) => {
    if (!filePath.startsWith(cedarPaths.api.src)) {
      return
    }

    console.log(
      ansis.dim(`[unlink] ${path.relative(cedarPaths.api.base, filePath)}`),
    )
    await loadApiFunctions(viteServer)
  })

  // ---------------------------------------------------------------------------
  // 4. Fastify server
  //    Mirrors the setup in @cedarjs/api-server's cedarFastifyAPI plugin,
  //    but uses the in-process LAMBDA_FUNCTIONS registry (loaded via Vite SSR)
  //    instead of importing from api/dist.
  // ---------------------------------------------------------------------------
  const app = fastify({ logger: false })

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

  const close = async () => {
    await app.close()
    await viteServer.close()
  }

  return { viteServer, close }
}
