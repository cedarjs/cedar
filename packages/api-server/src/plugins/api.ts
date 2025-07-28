import fastifyUrlData from '@fastify/url-data'
import type { Options as FastGlobOptions } from 'fast-glob'
import type { FastifyInstance } from 'fastify'
import fastifyRawBody from 'fastify-raw-body'

import type { GlobalContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'
import { coerceRootPath } from '@cedarjs/fastify-web/dist/helpers.js'

import type { Server } from '../createServerHelpers.js'
import { loadFastifyConfig } from '../fastify.js'

import { lambdaRequestHandler, loadFunctionsFromDist } from './lambdaLoader.js'

// Diagnostic logging for timeout debugging
const isDiagnosticMode =
  process.env.NODE_ENV === 'test' && process.env.CEDAR_DEBUG_TIMEOUT
function debugLog(message: string) {
  if (isDiagnosticMode) {
    console.log(`[CEDAR_DEBUG] ${new Date().toISOString()} - ${message}`)
  }
}

export interface RedwoodFastifyAPIOptions {
  redwood: {
    apiRootPath?: string
    fastGlobOptions?: FastGlobOptions
    discoverFunctionsGlob?: string | string[]
    loadUserConfig?: boolean
    configureServer?: (server: Server) => void | Promise<void>
  }
}

export async function redwoodFastifyAPI(
  fastify: FastifyInstance,
  opts: RedwoodFastifyAPIOptions,
) {
  debugLog('redwoodFastifyAPI: Starting plugin registration')

  const redwoodOptions = opts.redwood ?? {}
  redwoodOptions.apiRootPath ??= '/'
  redwoodOptions.apiRootPath = coerceRootPath(redwoodOptions.apiRootPath)
  redwoodOptions.fastGlobOptions ??= {}
  redwoodOptions.loadUserConfig ??= false

  debugLog('redwoodFastifyAPI: Registering fastifyUrlData')
  fastify.register(fastifyUrlData)
  // Starting in Fastify v4, we have to await the fastifyRawBody plugin's registration
  // to ensure it's ready
  debugLog('redwoodFastifyAPI: Registering fastifyRawBody')
  await fastify.register(fastifyRawBody)
  debugLog('redwoodFastifyAPI: fastifyRawBody registered')

  debugLog('redwoodFastifyAPI: Adding onRequest hook')
  fastify.addHook('onRequest', (_req, _reply, done) => {
    getAsyncStoreInstance().run(new Map<string, GlobalContext>(), done)
  })

  debugLog('redwoodFastifyAPI: Adding content type parsers')
  fastify.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    { parseAs: 'string' },
    fastify.defaultTextParser,
  )

  if (redwoodOptions.loadUserConfig) {
    debugLog('redwoodFastifyAPI: Loading user config')
    const { configureFastify } = await loadFastifyConfig()
    if (configureFastify) {
      debugLog('redwoodFastifyAPI: Configuring fastify with user config')
      await configureFastify(fastify, {
        side: 'api',
        apiRootPath: redwoodOptions.apiRootPath,
      })
      debugLog('redwoodFastifyAPI: User config applied')
    }
  }

  // Run users custom server configuration function
  if (redwoodOptions.configureServer) {
    debugLog('redwoodFastifyAPI: Running custom server configuration')
    await redwoodOptions.configureServer(fastify as Server)
    debugLog('redwoodFastifyAPI: Custom server configuration complete')
  }

  debugLog('redwoodFastifyAPI: Setting up route handlers')
  fastify.all(`${redwoodOptions.apiRootPath}:routeName`, lambdaRequestHandler)
  fastify.all(`${redwoodOptions.apiRootPath}:routeName/*`, lambdaRequestHandler)

  debugLog('redwoodFastifyAPI: Loading functions from dist')
  await loadFunctionsFromDist({
    fastGlobOptions: redwoodOptions.fastGlobOptions,
    discoverFunctionsGlob: redwoodOptions.discoverFunctionsGlob,
  })
  debugLog('redwoodFastifyAPI: Plugin registration complete')
}
