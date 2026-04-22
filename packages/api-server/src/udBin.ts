import path from 'node:path'

import { config } from 'dotenv-defaults'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { getPaths } from '@cedarjs/project-config'

import {
  description as udDescription,
  builder as udBuilder,
  handler as udHandler,
} from './udCLIConfig.js'

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
  .scriptName('cedar-ud-server')
  .strict()
  .alias('h', 'help')
  .alias('v', 'version')
  .command(
    '$0',
    udDescription,
    // @ts-expect-error The yargs types seem wrong; it's ok for builder to be a function
    udBuilder,
    udHandler,
  )
  .parse()
