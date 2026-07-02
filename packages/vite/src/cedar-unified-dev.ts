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

    // If the session itself errors or detaches, no more events will arrive —
    // unblock immediately rather than waiting for a pause that can never come.
    // If V8 already paused, still try to resume via fallback sessions.
    session.once('error', () => {
      if (paused) {
        tryResume()
      } else {
        resumedResolve?.()
      }
    })
    session.once('Inspector.detached', () => {
      if (paused) {
        tryResume()
      } else {
        resumedResolve?.()
      }
    })

    let paused = false
    session.once('Debugger.paused', () => {
      paused = true
      tryResume()
    })

    session.once('Debugger.resumed', () => {
      resumedResolve?.()
    })

    // Safety net: if neither paused, resumed, nor error fires within 5
    // minutes, force a resume attempt so the dev server doesn't hang.
    // If V8 never paused, the session may be stuck — resolve to unblock.
    const FIVE_MINUTES_MS = 5 * 60 * 1000
    const timeout = setTimeout(() => {
      if (paused) {
        tryResume()
      } else {
        resumedResolve?.()
      }
    }, FIVE_MINUTES_MS)

    let hasTriedResume = false
    const tryResume = () => {
      if (hasTriedResume) {
        return
      }
      // Only proceed when V8 has actually paused.  If the external debugger
      // disconnected before the pause took effect, wait for Debugger.paused
      // to fire — the Runtime.evaluate we queued will trigger it on the next
      // tick.
      if (!paused) {
        return
      }
      hasTriedResume = true

      // Attempt to resume.  Retry with throwaway sessions if the original
      // session was detached or its resume command was rejected.
      ;(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const s = attempt === 0 ? session : new inspector.Session()
          if (attempt > 0) {
            try {
              s.connect()
              await new Promise<void>((resolve, reject) => {
                s.post('Debugger.enable', (err) =>
                  err ? reject(err) : resolve(),
                )
              })
            } catch {
              continue
            }
          }

          const ok = await new Promise<boolean>((resolve) => {
            s.post('Debugger.resume', (err) => resolve(!err))
          })

          if (attempt > 0) {
            s.disconnect()
          }

          if (ok) {
            resumedResolve?.()
            return
          }
        }

        console.warn(
          '[cedar-unified-dev] Failed to clear debugger pause after ' +
            'external debugger disconnect.  API functions may pause on ' +
            'next execution.',
        )
        resumedResolve?.()
      })()
    }

    // Fire Debugger.pause and Runtime.evaluate. Fire-and-forget (void the
    // returned promise) — the post callback handles the response.
    void new Promise<void>((resolve, reject) => {
      session.post('Debugger.pause', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    }).catch(() => {
      // If the pause command itself failed, nothing will pause V8.  Unblock
      // so startup can continue.
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
      // Evaluate failure -> the pause flag from Debugger.pause may persist.
      // Best-effort: try to resume to clear it before unblocking.
      session.post('Debugger.resume', () => {
        resumedResolve?.()
      })
    })

    await resumedPromise
    clearTimeout(timeout)
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
