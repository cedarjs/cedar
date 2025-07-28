import fs from 'fs'
import path from 'path'

import ansis from 'ansis'
import { config } from 'dotenv-defaults'
import fg from 'fast-glob'
import fastify from 'fastify'

import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { getConfig, getPaths } from '@cedarjs/project-config'

import { resolveOptions } from './createServerHelpers.js'
import type {
  CreateServerOptions,
  Server,
  StartOptions,
} from './createServerHelpers.js'
import { redwoodFastifyAPI } from './plugins/api.js'

// Diagnostic logging for timeout debugging
const isDiagnosticMode =
  process.env.NODE_ENV === 'test' && process.env.CEDAR_DEBUG_TIMEOUT
function debugLog(message: string) {
  if (isDiagnosticMode) {
    console.log(`[CEDAR_DEBUG] ${new Date().toISOString()} - ${message}`)
  }
}

// Load .env files if they haven't already been loaded. This makes importing this file effectful:
//
// ```js
// # Loads dotenv...
// import { createServer } from '@cedarjs/api-server'
// ```
//
// We do it here and not in the function below so that users can access env vars before calling `createServer`
if (!process.env.REDWOOD_ENV_FILES_LOADED) {
  config({
    path: path.join(getPaths().base, '.env'),
    defaults: path.join(getPaths().base, '.env.defaults'),
    multiline: true,
  })

  process.env.REDWOOD_ENV_FILES_LOADED = 'true'
}

/**
 * Creates a server for api functions:
 *
 * ```js
 * import { createServer } from '@cedarjs/api-server'
 *
 * import { logger } from 'src/lib/logger'
 *
  async function main() {
 *   const server = await createServer({
 *     logger,
 *     apiRootPath: 'api'
 *     configureApiServer: (server) => {
 *       // Configure the API server fastify instance, e.g. add content type parsers
 *     },
 *   })
 *
 *   // Configure the returned fastify instance:
 *   server.register(myPlugin)
 *
 *   // When ready, start the server:
 *   await server.start()
 * }
 *
 * main()
 * ```
 */
export async function createServer(options: CreateServerOptions = {}) {
  debugLog('createServer: Starting')

  const {
    apiRootPath,
    fastifyServerOptions,
    discoverFunctionsGlob,
    configureApiServer,
    apiPort,
    apiHost,
  } = resolveOptions(options)

  debugLog('createServer: Options resolved')

  // Warn about `api/server.config.js`
  debugLog('createServer: Checking for server.config.js')
  const serverConfigPath = path.join(
    getPaths().base,
    getConfig().api.serverConfig,
  )

  if (fs.existsSync(serverConfigPath)) {
    debugLog('createServer: Found server.config.js, showing warning')
    console.warn(
      ansis.yellow(
        [
          '',
          `Ignoring \`config\` and \`configureServer\` in api/server.config.js.`,
          `Migrate them to api/src/server.{ts,js}:`,
          '',
          `\`\`\`js title="api/src/server.{ts,js}"`,
          '// Pass your config to `createServer`',
          'const server = createServer({',
          '  fastifyServerOptions: myFastifyConfig',
          '})',
          '',
          '// Then inline your `configureFastify` logic:',
          'server.register(myFastifyPlugin)',
          '```',
          '',
        ].join('\n'),
      ),
    )
  }
  debugLog('createServer: Server config check complete')

  // Initialize the fastify instance
  debugLog('createServer: Initializing fastify instance')
  const server: Server = Object.assign(fastify(fastifyServerOptions), {
    // `start` will get replaced further down in this file
    start: async () => {
      throw new Error('Not implemented yet')
    },
  })
  debugLog('createServer: Fastify instance created')

  debugLog('createServer: Adding onRequest hook')
  server.addHook('onRequest', (_req, _reply, done) => {
    getAsyncStoreInstance().run(new Map<string, GlobalContext>(), done)
  })

  debugLog('createServer: Registering redwoodFastifyAPI plugin')
  await server.register(redwoodFastifyAPI, {
    redwood: {
      apiRootPath,
      fastGlobOptions: {
        ignore: ['**/dist/functions/graphql.js'],
      },
      discoverFunctionsGlob,
      configureServer: configureApiServer,
    },
  })
  debugLog('createServer: redwoodFastifyAPI plugin registered')

  // If we can find `api/dist/functions/graphql.js`, register the GraphQL plugin
  debugLog('createServer: Searching for GraphQL function')
  const [graphqlFunctionPath] = await fg('dist/functions/graphql.{ts,js}', {
    cwd: getPaths().api.base,
    absolute: true,
  })
  debugLog(
    `createServer: GraphQL search complete, found: ${graphqlFunctionPath || 'none'}`,
  )

  if (graphqlFunctionPath) {
    debugLog('createServer: Importing GraphQL plugin')
    const { redwoodFastifyGraphQLServer } = await import('./plugins/graphql.js')
    debugLog('createServer: GraphQL plugin imported, importing GraphQL options')
    // This comes from a babel plugin that's applied to
    // api/dist/functions/graphql.{ts,js} in user projects
    const { __rw_graphqlOptions } = await import(
      `file://${graphqlFunctionPath}`
    )
    debugLog(
      'createServer: GraphQL options imported, registering GraphQL server',
    )

    await server.register(redwoodFastifyGraphQLServer, {
      redwood: {
        apiRootPath,
        graphql: __rw_graphqlOptions,
      },
    })
    debugLog('createServer: GraphQL server registered')
  }

  // For baremetal and pm2. See https://github.com/redwoodjs/redwood/pull/4744
  debugLog('createServer: Adding onReady hook')
  server.addHook('onReady', (done) => {
    process.send?.('ready')
    done()
  })

  debugLog('createServer: Adding onListen hook')
  server.addHook('onListen', (done) => {
    console.log(
      `Server listening at ${ansis.magenta(
        `${server.listeningOrigin}${apiRootPath}`,
      )}`,
    )
    done()
  })

  /**
   * A wrapper around `fastify.listen` that handles `--apiPort`, `REDWOOD_API_PORT` and [api].port in redwood.toml (same for host)
   *
   * The order of precedence is:
   * - `--apiPort`
   * - `REDWOOD_API_PORT`
   * - [api].port in redwood.toml
   */
  debugLog('createServer: Setting up server.start method')
  server.start = (options: StartOptions = {}) => {
    return server.listen({
      ...options,
      port: apiPort,
      host: apiHost,
    })
  }

  debugLog('createServer: Server creation complete')
  return server
}
