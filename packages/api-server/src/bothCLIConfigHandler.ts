import ansis from 'ansis'

import { redwoodFastifyWeb, coerceRootPath } from '@cedarjs/fastify-web'

import { getWebHost, getWebPort, getAPIHost, getAPIPort } from './cliHelpers.js'
import { createServer as createApiServer } from './createServer.js'
import { createFastifyInstance } from './fastify.js'
import { apiDistServerFileExists } from './serverFile.js'
import type { BothParsedOptions } from './types.js'

export async function handler(options: BothParsedOptions) {
  // A custom server file is a Fastify concept — Realtime, custom plugins,
  // and custom middleware registered there have no equivalent in this
  // in-process both-sides server, so there's no way to honour it here.
  // Running without it wouldn't degrade the app, it would silently produce
  // a different one, so refuse rather than continue.
  if (apiDistServerFileExists()) {
    throw new Error(
      'api/dist/server.js was found, but a custom server file is not ' +
        'supported when serving both sides from one process ' +
        '(`cedarjs-server` / `cedar serve`). It is a Fastify concept — ' +
        'anything registered there (Realtime, custom plugins, custom ' +
        'middleware) would silently be skipped if this continued.\n\n' +
        'Run the api and web sides as separate processes instead, so the ' +
        'api side goes through `cedarjs-server api`, which does run your ' +
        'server file:\n\n' +
        '  cedarjs-server api\n' +
        '  cedarjs-server web',
    )
  }

  const timeStart = Date.now()
  console.log(ansis.dim.italic('Starting API and Web Servers...'))

  // The web server is the one taking public traffic here — it proxies api
  // requests through to the api server — so it's the side that gets to use the
  // host's `HOST`/`PORT` env vars.
  options.webHost ??= getWebHost({ isPublicSide: true })
  options.webPort ??= getWebPort({ isPublicSide: true })
  options.apiHost ??= getAPIHost()
  options.apiPort ??= getAPIPort()

  options.apiRootPath = coerceRootPath(options.apiRootPath ?? '/')

  const apiProxyTarget = [
    'http://',
    options.apiHost.includes(':') ? `[${options.apiHost}]` : options.apiHost,
    ':',
    options.apiPort,
    options.apiRootPath,
  ].join('')

  const webFastify = await createFastifyInstance()
  webFastify.register(redwoodFastifyWeb, {
    redwood: {
      apiProxyTarget,
    },
  })

  const apiFastify = await createApiServer({
    apiRootPath: options.apiRootPath,
  })

  await webFastify.listen({
    port: options.webPort,
    host: options.webHost,
    listenTextResolver: getListenTextResolver('Web'),
  })

  webFastify.log.trace(
    { custom: { ...webFastify.initialConfig } },
    'Fastify server configuration',
  )
  webFastify.log.trace(`Registered plugins\n${webFastify.printPlugins()}`)

  await apiFastify.listen({
    port: options.apiPort,
    host: options.apiHost,
    listenTextResolver: getListenTextResolver('API'),
  })

  apiFastify.log.trace(
    { custom: { ...apiFastify.initialConfig } },
    'Fastify server configuration',
  )
  apiFastify.log.trace(`Registered plugins\n${apiFastify.printPlugins()}`)

  console.log(ansis.dim.italic('Took ' + (Date.now() - timeStart) + ' ms'))

  const webServer = ansis.green(webFastify.listeningOrigin)
  const apiServer = ansis.magenta(
    `${apiFastify.listeningOrigin}${options.apiRootPath}`,
  )
  const graphqlEndpoint = ansis.magenta(`${apiServer}graphql`)

  console.log(`Web server listening at ${webServer}`)
  console.log(`API server listening at ${apiServer}`)
  console.log(`GraphQL endpoint at ${graphqlEndpoint}`)

  process?.send?.('ready')
}

function getListenTextResolver(side: string) {
  return (address: string) => {
    // In the past, in development, we've prioritized showing a friendlier
    // host than the listen-on-all-ipv6-addresses '[::]'. Here we replace it
    // with 'localhost' only if 1) we're not in production and 2) it's there.
    // In production it's important to be transparent.
    if (process.env.NODE_ENV !== 'production') {
      address = address.replace(/http:\/\/\[::\]/, 'http://localhost')
    }

    return `${side} server listening at ${address}`
  }
}
