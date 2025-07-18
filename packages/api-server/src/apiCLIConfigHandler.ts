import ansis from 'ansis'

import { coerceRootPath } from '@cedarjs/fastify-web'

import { createServer } from './createServer'
import type { APIParsedOptions } from './types'

export async function handler(options: APIParsedOptions = {}) {
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
  // handler called by the watch bin (which is called by `yarn rw dev`).
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
