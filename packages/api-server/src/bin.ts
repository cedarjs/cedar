import path from 'path'

import { config } from 'dotenv-defaults'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { getPaths } from '@cedarjs/project-config'
import {
  description as webDescription,
  builder as webBuilder,
  handler as webHandler,
} from '@cedarjs/web-server'

import {
  description as apiDescription,
  builder as apiBuilder,
} from './apiCLIConfig.js'
import {
  description as bothDescription,
  builder as bothBuilder,
} from './bothCLIConfig.js'

if (!process.env.CEDAR_ENV_FILES_LOADED) {
  config({
    path: path.join(getPaths().base, '.env'),
    defaults: path.join(getPaths().base, '.env.defaults'),
    multiline: true,
  })

  process.env.CEDAR_ENV_FILES_LOADED = 'true'
}

process.env.NODE_ENV ??= 'production'

yargs(hideBin(process.argv))
  .scriptName('cedar-server')
  .strict()
  .alias('h', 'help')
  .alias('v', 'version')
  .command(
    '$0',
    bothDescription,
    // @ts-expect-error The yargs types seem wrong; it's ok for builder to be a function
    bothBuilder,
    // The API handlers import Fastify and the app's own modules, so they are
    // loaded lazily: the OpenTelemetry setup they import must be able to run
    // first through the preload flags placed on this process.
    async (argv: never) => {
      const { handler } = await import('./bothCLIConfigHandler.js')
      await handler(argv)
    },
  )
  .command(
    'api',
    apiDescription,
    // @ts-expect-error The yargs types seem wrong; it's ok for builder to be a function
    apiBuilder,
    async (argv: never) => {
      const { handler } = await import('./apiCLIConfigHandler.js')
      await handler(argv)
    },
  )
  .command(
    'web',
    webDescription,
    // @ts-expect-error The yargs types seem wrong; it's ok for builder to be a function
    webBuilder,
    webHandler,
  )
  .parse()
