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

export interface CedarFastifyAPIOptions {
  // Have to keep this named `redwood` to avoid breaking changes
  redwood: {
    apiRootPath?: string
    fastGlobOptions?: FastGlobOptions
    discoverFunctionsGlob?: string | string[]
    loadUserConfig?: boolean
    configureServer?: (server: Server) => void | Promise<void>
    onRoutesDiscovered?: (routes: unknown[]) => void | Promise<void>
  }
}

export async function cedarFastifyAPI(
  fastify: FastifyInstance,
  opts: CedarFastifyAPIOptions,
) {
  const cedarOptions = opts.redwood ?? {}
  cedarOptions.apiRootPath ??= '/'
  cedarOptions.apiRootPath = coerceRootPath(cedarOptions.apiRootPath)
  cedarOptions.fastGlobOptions ??= {}
  cedarOptions.loadUserConfig ??= false

  fastify.register(fastifyUrlData)
  // Starting in Fastify v4, we have to await the fastifyRawBody plugin's registration
  // to ensure it's ready
  await fastify.register(fastifyRawBody)

  fastify.addHook('onRequest', (_req, _reply, done) => {
    getAsyncStoreInstance().run(new Map<string, GlobalContext>(), done)
  })

  fastify.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    { parseAs: 'string' },
    fastify.defaultTextParser,
  )

  if (cedarOptions.loadUserConfig) {
    const { configureFastify } = await loadFastifyConfig()
    if (configureFastify) {
      await configureFastify(fastify, {
        side: 'api',
        apiRootPath: cedarOptions.apiRootPath,
      })
    }
  }

  // Run users custom server configuration function
  if (cedarOptions.configureServer) {
    await cedarOptions.configureServer(fastify as Server)
  }

  fastify.all(`${cedarOptions.apiRootPath}:routeName`, lambdaRequestHandler)
  fastify.all(`${cedarOptions.apiRootPath}:routeName/*`, lambdaRequestHandler)
  await loadFunctionsFromDist({
    fastGlobOptions: cedarOptions.fastGlobOptions,
    discoverFunctionsGlob: cedarOptions.discoverFunctionsGlob,
  })
}
