import ansis from 'ansis'

import { getOTelSetupFileUrl } from '@cedarjs/project-config'

import { apiDistServerFileExists, runApiDistServerFile } from './serverFile.js'
import type { APIParsedOptions } from './types.js'

export async function handler(options: APIParsedOptions = {}) {
  // A custom api/src/server.ts is where Realtime, custom Fastify plugins,
  // and custom middleware get registered. Running the default server
  // instead wouldn't fail — it would just silently produce a different app.
  if (apiDistServerFileExists()) {
    await runApiDistServerFile(options)
    return
  }

  // The OpenTelemetry SDK setup must be imported before Fastify, Prisma and
  // the app's own modules are loaded, or the instrumentations can't patch
  // them. Fastify and the server factory are imported after it for the same
  // reason. When the process was started with the setup in an `--import`
  // flag, importing it again here does nothing
  const otelSetupFileUrl = getOTelSetupFileUrl()

  if (otelSetupFileUrl !== undefined) {
    await import(otelSetupFileUrl)
  }

  const { coerceRootPath } = await import('@cedarjs/fastify-web')
  const { createServer } = await import('./createServer.js')

  const timeStart = Date.now()
  console.log(ansis.dim.italic('Starting API Server...'))

  options.apiRootPath = coerceRootPath(options.apiRootPath ?? '/')

  const fastify = await createServer({
    apiRootPath: options.apiRootPath,
    apiHost: options.host,
    apiPort: options.port,
  })

  await fastify.start()

  fastify.log.trace(
    { custom: { ...fastify.initialConfig } },
    'Fastify server configuration',
  )
  fastify.log.trace(`Registered plugins\n${fastify.printPlugins()}`)

  console.log(ansis.dim.italic('Took ' + (Date.now() - timeStart) + ' ms'))

  // We have this logic for `apiServerHandler` because this is the only
  // handler called by the watch bin (which is called by `yarn cedar dev`).
  let address = fastify.listeningOrigin
  if (process.env.NODE_ENV !== 'production') {
    address = address.replace(/http:\/\/\[::\]/, 'http://localhost')
  }

  const apiServer = ansis.magenta(`${address}${options.apiRootPath}`)
  const graphqlEndpoint = ansis.magenta(`${apiServer}graphql`)

  console.log(`API server listening at ${apiServer}`)
  console.log(`GraphQL endpoint at ${graphqlEndpoint}`)

  process?.send?.('ready')
}
