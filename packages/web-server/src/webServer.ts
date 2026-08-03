import fs from 'node:fs'
import path from 'node:path'

import ansis from 'ansis'
import Fastify from 'fastify'

import { redwoodFastifyWeb } from '@cedarjs/fastify-web'
import { getConfig, getPaths, readEnvVar } from '@cedarjs/project-config'

import type { ParsedOptions } from './types.js'

function parsePort(value: string, envVarName: string) {
  const port = parseInt(value, 10)

  if (Number.isNaN(port)) {
    throw new Error(
      `Invalid ${envVarName} env var: "${value}". Must be an integer.`,
    )
  }

  return port
}

export async function serveWeb(options: ParsedOptions = {}) {
  const start = Date.now()
  console.log(ansis.dim.italic('Starting Web Server...'))

  const distIndexExists = fs.existsSync(
    path.join(getPaths().web.dist, 'index.html'),
  )
  if (!distIndexExists) {
    throw new Error(
      'no built files to serve; run `yarn cedar build web` before serving the web side',
    )
  }

  // NOTE: This mirrors `getWebHost`/`getWebPort` in @cedarjs/api-server's
  // cliHelpers. It's duplicated because this package doesn't depend on
  // @cedarjs/api-server.
  //
  // `HOST`/`PORT` are how container hosts (Railway, Render, Fly.io, Cloud Run,
  // Heroku) tell an app what to bind to. They're only consulted when nothing
  // more specific was given, which means they don't apply when both sides are
  // served together — `cedar serve` passes an explicit `--port` to this server.
  const webPort = readEnvVar('CEDAR_WEB_PORT', {
    deprecatedAlias: 'REDWOOD_WEB_PORT',
  })

  if (webPort) {
    options.port ??= parsePort(webPort, 'CEDAR_WEB_PORT')
  }
  if (process.env.PORT) {
    options.port ??= parsePort(process.env.PORT, 'PORT')
  }
  options.port ??= getConfig().web.port

  options.host ??= readEnvVar('CEDAR_WEB_HOST', {
    deprecatedAlias: 'REDWOOD_WEB_HOST',
  })
  options.host ??= process.env.HOST
  options.host ??= getConfig().web.host
  options.host ??= process.env.NODE_ENV === 'production' ? '0.0.0.0' : '::'

  if (process.env.NODE_ENV === 'production' && options.host !== '0.0.0.0') {
    console.warn(
      `Warning: host '${options.host}' may need to be '0.0.0.0' in production for containerized deployments`,
    )
  }

  const fastify = Fastify({
    requestTimeout: 15_000,
    logger: {
      level:
        process.env.LOG_LEVEL ??
        (process.env.NODE_ENV === 'development' ? 'debug' : 'warn'),
    },
  })

  fastify.register(redwoodFastifyWeb, { redwood: options })

  const address = await fastify.listen({
    port: options.port,
    host: options.host,
  })

  console.log(ansis.dim.italic('Took ' + (Date.now() - start) + ' ms'))
  console.log(`Web server listening at ${ansis.green(address)}`)
}
