import fs from 'node:fs'
import path from 'path'

import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import * as apiServerCLIConfig from '@cedarjs/api-server/apiCliConfig'
import * as bothServerCLIConfig from '@cedarjs/api-server/bothCliConfig'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { projectIsEsm } from '@cedarjs/project-config'
import * as webServerCLIConfig from '@cedarjs/web-server'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { getPaths, getConfig } from '../lib/index.js'
// @ts-expect-error - Types not available for JS files
import { serverFileExists } from '../lib/project.js'

// @ts-expect-error - Types not available for JS files
import { webSsrServerHandler } from './serveWebHandler.js'

export const command = 'serve [side]'
export const description =
  'Start a server for serving both the api and web sides'
type ServeArgv = Record<string, unknown> & {
  _: (string | number)[]
  port?: number
  host?: string
  socket?: string
  apiRootPath?: string
  apiHost?: string
}

export const builder = async (yargs: Argv) => {
  const rscEnabled = getConfig().experimental?.rsc?.enabled
  const streamingEnabled = getConfig().experimental?.streamingSsr?.enabled

  yargs
    // @ts-expect-error - Yargs command builder type in dependencies is narrower than runtime behavior
    .command({
      command: '$0',
      description: bothServerCLIConfig.description,
      builder: bothServerCLIConfig.builder,
      handler: async (argv: ServeArgv) => {
        recordTelemetryAttributes({
          command: 'serve',
          port: argv.port,
          host: argv.host,
          socket: argv.socket,
        })

        // Run the server file, if it exists, with web side also
        if (serverFileExists()) {
          // @ts-expect-error - Types not available for JS files
          const serveBothHandlers = await import('./serveBothHandler.js')
          await serveBothHandlers.bothServerFileHandler(argv)
        } else if (rscEnabled || streamingEnabled) {
          // @ts-expect-error - Types not available for JS files
          const serveBothHandlers = await import('./serveBothHandler.js')
          await serveBothHandlers.bothSsrRscServerHandler(argv, rscEnabled)
        } else {
          if (!projectIsEsm()) {
            const { handler } =
              await import('@cedarjs/api-server/cjs/bothCliConfigHandler')
            await handler(argv)
          } else {
            await bothServerCLIConfig.handler(argv)
          }
        }
      },
    })
    // @ts-expect-error - Yargs TS types aren't very good
    .command({
      command: 'api',
      description: apiServerCLIConfig.description,
      builder: apiServerCLIConfig.builder,
      handler: async (argv: ServeArgv) => {
        recordTelemetryAttributes({
          command: 'serve',
          port: argv.port,
          host: argv.host,
          socket: argv.socket,
          apiRootPath: argv.apiRootPath,
        })

        // Run the server file, if it exists, api side only
        if (serverFileExists()) {
          // @ts-expect-error - Types not available for JS files
          const { apiServerFileHandler } = await import('./serveApiHandler.js')
          await apiServerFileHandler(argv)
        } else {
          if (!projectIsEsm()) {
            const { handler } =
              await import('@cedarjs/api-server/cjs/apiCliConfigHandler')
            await handler(argv)
          } else {
            await apiServerCLIConfig.handler(argv)
          }
        }
      },
    })
    // @ts-expect-error - Yargs TS types aren't very good
    .command({
      command: 'web',
      description: webServerCLIConfig.description,
      builder: webServerCLIConfig.builder,
      handler: async (argv: ServeArgv) => {
        recordTelemetryAttributes({
          command: 'serve',
          port: argv.port,
          host: argv.host,
          socket: argv.socket,
          apiHost: argv.apiHost,
        })

        if (streamingEnabled) {
          await webSsrServerHandler(rscEnabled)
        } else {
          // @cedarjs/web-server is still built as CJS only, so we don't need
          // the same solution here as we do for the api side
          await webServerCLIConfig.handler(argv)
        }
      },
    })
    .middleware((argv: ServeArgv) => {
      recordTelemetryAttributes({
        command: 'serve',
      })

      // Make sure the relevant side has been built, before serving
      const positionalArgs = argv._

      if (
        positionalArgs.includes('web') &&
        !fs.existsSync(path.join(getPaths().web.dist, 'index.html'))
      ) {
        console.error(
          c.error(
            '\n Please run `yarn cedar build web` before trying to serve web. \n',
          ),
        )
        process.exit(1)
      }

      const apiSideExists = fs.existsSync(getPaths().api.base)
      if (positionalArgs.includes('api')) {
        if (!apiSideExists) {
          console.error(
            c.error(
              '\n Unable to serve the api side as no `api` folder exists. \n',
            ),
          )
          process.exit(1)
        }

        if (!fs.existsSync(path.join(getPaths().api.dist))) {
          console.error(
            c.error(
              '\n Please run `yarn cedar build api` before trying to serve api. \n',
            ),
          )
          process.exit(1)
        }
      }

      // serve both
      if (positionalArgs.length === 1) {
        if (!apiSideExists && !rscEnabled) {
          console.error(
            c.error(
              '\n Unable to serve the both sides as no `api` folder exists. Please use `yarn cedar serve web` instead. \n',
            ),
          )
          process.exit(1)
        }

        // We need the web side (and api side, if it exists) to have been built
        if (
          (fs.existsSync(path.join(getPaths().api.base)) &&
            !fs.existsSync(path.join(getPaths().api.dist))) ||
          !fs.existsSync(path.join(getPaths().web.dist, 'index.html'))
        ) {
          console.error(
            c.error(
              '\n Please run `yarn cedar build` before trying to serve your redwood app. \n',
            ),
          )
          process.exit(1)
        }
      }

      // Set NODE_ENV to production, if not set
      if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = 'production'
      }
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#serve',
      )}`,
    )
}
