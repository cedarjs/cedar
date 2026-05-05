#!/usr/bin/env node
import type { IncomingMessage, ServerResponse } from 'node:http'

import { createServerAdapter } from '@whatwg-node/server'
import { createServer } from 'vite'
import yargsParser from 'yargs-parser'

import { getPaths, getConfig } from '@cedarjs/project-config'

import { startApiDevMiddleware } from './apiDevMiddleware.js'

function isViteInternalRequest(url: string): boolean {
  return (
    url.startsWith('/@') ||
    url.startsWith('/__vite') ||
    url.startsWith('/__hmr') ||
    url.includes('?import') ||
    url.includes('?t=') ||
    url.includes('?v=')
  )
}

const startUnifiedDevServer = async () => {
  // Signal to Cedar plugins (e.g. cedarWaitForApiServer) that we're running
  // in unified-dev mode so they can skip behaviours that assume a separate
  // API listener.
  process.env.__CEDAR_UNIFIED_DEV = 'true'

  const rwPaths = getPaths()
  const cedarConfig = getConfig()
  const configFile = rwPaths.web.viteConfig

  if (!configFile) {
    throw new Error('Could not locate your web/vite.config.{js,ts} file')
  }

  const {
    force: forceOptimize,
    debug,
    port: portArg,
    apiPort: _apiPortArg,
    _: _positional,
    ...serverArgs
  } = yargsParser(process.argv.slice(2), {
    boolean: ['https', 'open', 'strictPort', 'force', 'cors', 'debug'],
    number: ['port', 'apiPort'],
  })

  const webPort =
    (portArg as number | undefined) ?? cedarConfig.web.port ?? 8910

  // Start the API dev middleware (Vite SSR, no separate HTTP listener).
  // API requests will be handled inline via the web Vite dev server's
  // middleware pipeline.
  const { close: closeApi, handler: apiHandler } = await startApiDevMiddleware()
  const apiAdapter = createServerAdapter(apiHandler)

  const devServer = await createServer({
    configFile,
    // env file is handled by Cedar's plugins
    envFile: false,
    optimizeDeps: {
      // This is the only value that isn't a server option
      force: forceOptimize as boolean | undefined,
    },
    server: {
      port: webPort,
      ...serverArgs,
    },
    logLevel: debug ? 'info' : undefined,
    plugins: [
      {
        name: 'cedar-api-middleware',
        apply: 'serve',
        configureServer(server) {
          const apiUrl = cedarConfig.web.apiUrl.replace(/\/$/, '')
          const apiGqlUrl = cedarConfig.web.apiGraphQLUrl ?? apiUrl + '/graphql'

          function isApiRequest(url: string): boolean {
            return (
              url === apiUrl ||
              url.startsWith(apiUrl + '/') ||
              url.startsWith(apiUrl + '?') ||
              url === apiGqlUrl ||
              url.startsWith(apiGqlUrl + '/') ||
              url.startsWith(apiGqlUrl + '?')
            )
          }

          server.middlewares.use(
            async (
              req: IncomingMessage,
              res: ServerResponse,
              next: () => void,
            ) => {
              const url = req.url ?? '/'

              if (isViteInternalRequest(url)) {
                return next()
              }

              if (!isApiRequest(url)) {
                return next()
              }

              try {
                await apiAdapter(req, res)
              } catch (err) {
                console.error(
                  '[cedar-api-middleware] Error handling API request:',
                  err,
                )

                if (!res.headersSent) {
                  res.writeHead(500, { 'Content-Type': 'application/json' })
                }

                res.end(
                  JSON.stringify(
                    {
                      errors: [
                        {
                          message:
                            err instanceof Error
                              ? err.message
                              : 'Internal Server Error',
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                )
              }
            },
          )
        },
      },
    ],
  })

  await devServer.listen()

  process.stdin.on('data', async (data) => {
    const str = data.toString().trim().toLowerCase()
    if (str === 'rs' || str === 'restart') {
      await devServer.restart(true)
    }
  })

  devServer.printUrls()

  if (debug) {
    console.log('~~~ Vite Server Config ~~~')
    console.log(JSON.stringify(devServer.config, null, 2))
    console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~')
  }

  // Clean shutdown on signals – Ctrl+C sends SIGINT, process managers use SIGTERM
  const shutdown = async () => {
    await devServer.close()
    await closeApi()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

startUnifiedDevServer().catch((err) => {
  console.error('Failed to start unified dev server:', err)
  process.exit(1)
})
