import type { IncomingMessage, ServerResponse } from 'node:http'

import { createServerAdapter } from '@whatwg-node/server'
import { createServer } from 'vite'
import yargsParser from 'yargs-parser'

import { getPaths, getConfig } from '@cedarjs/project-config'

import { startApiDevMiddleware } from './apiDevMiddleware.js'

function isViteInternalRequest(url: string): boolean {
  const pathname = url.split('?')[0]

  return (
    pathname.startsWith('/@') ||
    pathname.startsWith('/__vite') ||
    pathname.startsWith('/__hmr')
  )
}

function isApiRequest(url: string, apiUrl: string, apiGqlUrl: string): boolean {
  return (
    url === apiUrl ||
    url.startsWith(apiUrl + '/') ||
    url.startsWith(apiUrl + '?') ||
    url === apiGqlUrl ||
    url.startsWith(apiGqlUrl + '/') ||
    url.startsWith(apiGqlUrl + '?')
  )
}

export function parseCliArgs(argv = process.argv) {
  const {
    force: forceOptimize,
    debug,
    port: portArg,
    apiPort: _apiPortArg,
    'debug-port': debugPort,
    'debug-brk': debugBrk,
    _: _positional,
    ...serverArgs
  } = yargsParser(argv.slice(2), {
    boolean: [
      'https',
      'open',
      'strictPort',
      'force',
      'cors',
      'debug',
      'debug-brk',
    ],
    number: ['port', 'apiPort', 'debug-port'],
  })

  return { forceOptimize, debug, portArg, debugPort, debugBrk, serverArgs }
}

export async function openDebugger(port: number, waitForDebugger = false) {
  const inspector = await import('node:inspector')
  inspector.open(port, '127.0.0.1')
  if (waitForDebugger) {
    // Wait for the debugger to connect and send
    // Runtime.runIfWaitingForDebugger.  Editors send Debugger.enable before
    // Runtime.runIfWaitingForDebugger, so the Debugger domain is already
    // active when waitForDebugger() unblocks.
    inspector.waitForDebugger()

    // Use inspector.Session to arm a pause and wait for the debugger's
    // Debugger.resume.  This gives the user time to set breakpoints on
    // API functions before loadApiFunctions() runs.
    const session = new inspector.Session()
    session.connect()

    // Node.js inspector.Session.post() returns a Promise at runtime despite
    // being typed as void.  We await it because the Debugger must be enabled
    // before we fire Debugger.pause.
    // eslint-disable-next-line @typescript-eslint/await-thenable
    await session.post('Debugger.enable')

    // Register the resumed listener BEFORE firing pause/evaluate so it
    // doesn't miss the event.  session.post() dispatches the command
    // synchronously — V8 may process it and emit Debugger.resumed on
    // the Session before session.post() returns.
    let resumedResolve: () => void
    const resumedPromise = new Promise<void>((resolve) => {
      resumedResolve = resolve
    })
    session.once('Debugger.resumed', () => {
      resumedResolve()
    })

    // Fire Debugger.pause and Runtime.evaluate — these execute
    // synchronously within V8, arming the pause flag and then executing
    // JS (which checks the flag and pauses).  We do not await the
    // returned promises because the commands will complete after the
    // debugger resumes.  Catch rejections so startup doesn't hang if
    // the debugger disconnects or changes state unexpectedly.
    void new Promise<void>((resolve, reject) => {
      session.post('Debugger.pause', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    }).catch(() => {
      resumedResolve?.()
    })

    void new Promise<void>((resolve, reject) => {
      session.post('Runtime.evaluate', { expression: '1' }, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    }).catch(() => {
      resumedResolve?.()
    })

    await resumedPromise
  }
}

export async function startUnifiedDevServer() {
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

  const { forceOptimize, debug, portArg, debugPort, debugBrk, serverArgs } =
    parseCliArgs()

  if (debugPort !== undefined) {
    await openDebugger(debugPort, debugBrk)
  }

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

              if (!isApiRequest(url, apiUrl, apiGqlUrl)) {
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
