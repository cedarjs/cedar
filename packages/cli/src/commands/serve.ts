import { fork } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import * as apiServerCLIConfig from '@cedarjs/api-server/apiCliConfig'
import * as bothServerCLIConfig from '@cedarjs/api-server/bothCliConfig'
import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { projectIsEsm } from '@cedarjs/project-config'
import * as webServerCLIConfig from '@cedarjs/web-server'

// @ts-expect-error - Types not available for JS files
import { getPaths, getConfig } from '../lib/index.js'
// @ts-expect-error - Types not available for JS files
import { serverFileExists } from '../lib/project.js'

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
  ud?: boolean
}

export const builder = async (yargs: Argv) => {
  const rscEnabled = getConfig().experimental?.rsc?.enabled
  const streamingEnabled = getConfig().experimental?.streamingSsr?.enabled

  yargs
    // @ts-expect-error - Yargs TS types aren't very good
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
          const serveBothHandlers = await import('./serveBothHandler.js')
          await serveBothHandlers.bothServerFileHandler(argv)
        } else if (rscEnabled || streamingEnabled) {
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
      builder: (yargs: Argv) => {
        if (typeof apiServerCLIConfig.builder === 'function') {
          apiServerCLIConfig.builder(yargs)
        }
        return yargs.option('ud', {
          // UD serving is opt-in. Pass --ud to use the new srvx server instead
          // of the legacy Fastify server.
          description:
            'Use the Universal Deploy server (srvx). Pass --ud to opt in; the default is Fastify.',
          type: 'boolean',
          default: false,
        })
      },
      handler: async (argv: ServeArgv) => {
        recordTelemetryAttributes({
          command: 'serve',
          port: argv.port,
          host: argv.host,
          socket: argv.socket,
          apiRootPath: argv.apiRootPath,
        })

        if (argv.ud) {
          // Launch the Vite-built Universal Deploy Node server entry produced
          // by `cedar build api`. The entry at api/dist/ud/index.js is a
          // self-contained srvx server that imports virtual:ud:catch-all,
          // resolved by cedarUniversalDeployPlugin to Cedar's aggregate fetch
          // dispatcher.
          const udEntryPath = path.join(getPaths().api.dist, 'ud', 'index.js')

          if (!fs.existsSync(udEntryPath)) {
            console.error(
              c.error(
                `\n Universal Deploy server entry not found at ${udEntryPath}.\n` +
                  ' Please run `yarn cedar build api` before serving.\n',
              ),
            )
            process.exit(1)
          }

          const udArgs: string[] = []

          if (argv.port) {
            udArgs.push('--port', String(argv.port))
          }

          if (argv.host) {
            udArgs.push('--host', argv.host)
          }

          await new Promise<void>((resolve, reject) => {
            const child = fork(udEntryPath, udArgs, {
              execArgv: process.execArgv,
              env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV ?? 'production',
                PORT: argv.port ? String(argv.port) : process.env.PORT,
                HOST: argv.host ?? process.env.HOST,
              },
            })

            child.on('error', reject)
            child.on('exit', (code) => {
              if (code !== 0) {
                reject(new Error(`UD server exited with code ${code}`))
              } else {
                resolve()
              }
            })
          })

          return
        }

        // Run the server file, if it exists, api side only
        if (serverFileExists()) {
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
        !webSideIsBuilt(streamingEnabled || rscEnabled)
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
              '\nUnable to serve web and api as no `api` folder exists. ' +
                'Please use `yarn cedar serve web` instead. \n',
            ),
          )
          process.exit(1)
        }

        // We need the web side (and api side, if it exists) to have been built

        const apiExistsButIsNotBuilt =
          apiSideExists && !fs.existsSync(getPaths().api.dist)

        if (
          apiExistsButIsNotBuilt ||
          !webSideIsBuilt(streamingEnabled || rscEnabled)
        ) {
          console.error(
            c.error(
              '\nPlease run `yarn cedar build` before trying to serve your ' +
                'Cedar app.\n',
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

function webSideIsBuilt(isStreamingOrRSC: boolean) {
  // For Streaming and RSC apps the traditional SPA flow (index.html →
  // load JS → render client-side) is replaced by: server receives request →
  // renders React to HTML stream → sends HTML with hydration hooks →
  // client hydrates. That's why checking for index.html is wrong for SSR/RSC
  // apps. Instead we check for the manifest file that both streaming and RSC
  // uses.
  if (isStreamingOrRSC) {
    return fs.existsSync(
      path.join(getPaths().web.distBrowser, 'client-build-manifest.json'),
    )
  } else {
    return fs.existsSync(path.join(getPaths().web.dist, 'index.html'))
  }
}
