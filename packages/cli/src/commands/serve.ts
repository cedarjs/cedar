import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { serve as serveSrvx } from 'srvx'
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

/**
 * Resolve the path to the UD server entry, checking for either .mjs or .js
 * extension. Vite's SSR build outputs index.mjs when the project is ESM;
 * the serve command must accept both.
 */
function resolveUDEntryPath(): string | null {
  const base = path.join(getPaths().api.dist, 'ud', 'index')
  for (const ext of ['.mjs', '.js']) {
    const entryPath = base + ext
    if (fs.existsSync(entryPath)) {
      return entryPath
    }
  }
  return null
}

/**
 * Import the built UD Fetchable from disk and host it with srvx on the
 * configured host and port. Does NOT fork — the Fetchable runs in-process.
 *
 * Returns the srvx server instance so callers can await server.ready() or
 * close it on shutdown.
 */
async function startUDServer(
  entryPath: string,
  host: string,
  port: number,
): Promise<ReturnType<typeof serveSrvx>> {
  const mod = await import(pathToFileURL(entryPath).href)
  const fetchable = mod.default ?? mod

  if (!fetchable || typeof fetchable.fetch !== 'function') {
    throw new Error(
      `UD entry at ${entryPath} does not export a Fetchable ` +
        '(`export default { fetch }`).',
    )
  }

  const server = serveSrvx({
    ...fetchable,
    port,
    hostname: host,
    gracefulShutdown: false,
    manual: true,
  })

  server.serve()

  await server.ready()

  return server
}

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
  apiPort?: number
  webHost?: string
  webPort?: number
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
      builder: (yargs: Argv) => {
        bothServerCLIConfig.builder(yargs)
        return yargs.option('ud', {
          description:
            'Use the Universal Deploy server for the API side. The web side ' +
            'is served by the existing static file server. Pass --ud to opt ' +
            'in; the default is Fastify for both sides.',
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
        })

        if (argv.ud) {
          if (argv.port) {
            console.error(
              c.error(
                '\n The --port flag is not supported with --ud. ' +
                  'Use --web-port and --api-port instead.\n',
              ),
            )
            process.exit(1)
          }

          const udEntryPath = resolveUDEntryPath()

          if (!udEntryPath) {
            console.error(
              c.error(
                '\n Universal Deploy server entry not found. ' +
                  ' Please run `yarn cedar build --ud` before serving.\n',
              ),
            )
            process.exit(1)
          }

          const webDistIndexHtml = path.join(getPaths().web.dist, 'index.html')

          if (!fs.existsSync(webDistIndexHtml)) {
            console.error(
              c.error(
                '\n Web build artifacts not found.\n' +
                  ' Please run `yarn cedar build` before serving.\n',
              ),
            )
            process.exit(1)
          }

          if (serverFileExists()) {
            console.warn(
              c.warning(
                '\n Note: api/src/server.ts was detected. ' +
                  'This file is a Fastify concept and will be ignored when using --ud. ' +
                  'You are testing the experimental UD support, so the behavior will not match your production Fastify setup.\n',
              ),
            )
          }

          const { getAPIHost, getAPIPort, getWebHost, getWebPort } =
            await import('@cedarjs/api-server/cliHelpers')

          const apiPort = argv.apiPort ?? getAPIPort()
          const apiHost = argv.apiHost ?? getAPIHost()
          const webPort = argv.webPort ?? getWebPort()
          const webHost = argv.webHost ?? getWebHost()

          const apiRootPath = argv.apiRootPath ?? '/'
          const apiProxyTarget = [
            'http://',
            apiHost.includes(':') ? `[${apiHost}]` : apiHost,
            ':',
            apiPort,
            apiRootPath,
          ].join('')

          // Start the Fastify web server (same as before)
          const { redwoodFastifyWeb } = await import('@cedarjs/fastify-web')
          const { createFastifyInstance } =
            await import('@cedarjs/api-server/fastify')

          const webFastify = await createFastifyInstance()
          webFastify.register(redwoodFastifyWeb, {
            redwood: {
              apiProxyTarget,
            },
          })

          await webFastify.listen({
            port: webPort,
            host: webHost,
          })

          // Import and host the UD Fetchable in-process with srvx
          console.log(`Web server listening at http://${webHost}:${webPort}`)
          process.stdout.write(
            `API server starting at http://${apiHost}:${apiPort}...`,
          )

          await startUDServer(udEntryPath, apiHost, apiPort)

          process.stdout.write(
            `\rAPI server listening at http://${apiHost}:${apiPort}\n`,
          )

          return
        }

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
            'Use the Universal Deploy server. Pass --ud to opt in; the default is Fastify.',
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
          const udEntryPath = resolveUDEntryPath()

          if (!udEntryPath) {
            console.error(
              c.error(
                '\n Universal Deploy server entry not found. ' +
                  ' Please run `yarn cedar build --ud` before serving.\n',
              ),
            )
            process.exit(1)
          }

          const apiPort = argv.port ?? parseInt(process.env.PORT ?? '8911', 10)
          const apiHost = argv.host ?? process.env.HOST ?? 'localhost'

          process.stdout.write(
            `API server starting at http://${apiHost}:${apiPort}...`,
          )

          await startUDServer(udEntryPath, apiHost, apiPort)

          process.stdout.write(
            `\rAPI server listening at http://${apiHost}:${apiPort}\n`,
          )

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

        if (argv.ud) {
          const udEntryPath = resolveUDEntryPath()
          if (!udEntryPath) {
            console.error(
              c.error(
                '\n Universal Deploy server entry not found. ' +
                  ' Please run `yarn cedar build --ud` before serving.\n',
              ),
            )
            process.exit(1)
          }
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

        if (argv.ud) {
          const udEntryPath = resolveUDEntryPath()
          if (!udEntryPath) {
            console.error(
              c.error(
                '\n Universal Deploy server entry not found. ' +
                  ' Please run `yarn cedar build --ud` before serving.\n',
              ),
            )
            process.exit(1)
          }

          const webDistIndexHtml = path.join(getPaths().web.dist, 'index.html')
          if (!fs.existsSync(webDistIndexHtml)) {
            console.error(
              c.error(
                '\n Web build artifacts not found.\n' +
                  ' Please run `yarn cedar build` before serving.\n',
              ),
            )
            process.exit(1)
          }
        } else {
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
