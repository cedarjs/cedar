import type { IncomingMessage, ServerResponse } from 'node:http'

import { createServerAdapter } from '@whatwg-node/server'
import { createServer } from 'vite'
import yargsParser from 'yargs-parser'

import { getPaths, getConfig } from '@cedarjs/project-config'

import { startApiDevMiddleware } from './apiDevMiddleware.js'
import { startJobsDevWorkers } from './jobsDevMiddleware.js'

/**
 * How long to wait for the dev servers to close gracefully after a SIGINT or
 * SIGTERM before forcing the process to exit.
 */
const SHUTDOWN_TIMEOUT_MS = 5_000

interface ShutdownHandlerOptions {
  /** Closes the running servers. Called once, on the first signal. */
  close: () => Promise<void>
  timeoutMs?: number
  exit?: (code: number) => void
  logger?: Pick<typeof console, 'warn' | 'error'>
}

/**
 * Build the SIGINT/SIGTERM handler for the unified dev server.
 *
 * The handler always terminates the process, and does so promptly. Vite's
 * `close()` waits for in-flight requests and open HMR websocket connections to
 * drain, which is not guaranteed to finish, so the graceful path is bounded by
 * a timeout. A second signal skips the wait entirely, which is what a user
 * pressing Ctrl+C twice is asking for.
 */
export function createShutdownHandler({
  close,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  exit = (code) => process.exit(code),
  logger = console,
}: ShutdownHandlerOptions) {
  let shuttingDown = false

  return async function shutdown() {
    // A second Ctrl+C means "stop waiting". Leave immediately.
    if (shuttingDown) {
      exit(0)
      return
    }

    shuttingDown = true

    const forceExitTimer = setTimeout(() => {
      logger.warn(
        `Dev server did not shut down within ${timeoutMs}ms. Forcing exit.`,
      )
      exit(0)
    }, timeoutMs)

    // Don't let the timer itself keep the process alive
    forceExitTimer.unref()

    try {
      await close()
    } catch (e) {
      // Report, but still exit. A `close()` that rejects used to reject inside
      // the signal handler, which skipped `process.exit()` entirely and left
      // the server running and holding its ports.
      const message = e instanceof Error ? e.message : String(e)
      logger.error(`Error while shutting down the dev server: ${message}`)
    } finally {
      clearTimeout(forceExitTimer)
    }

    exit(0)
  }
}

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

/**
 * Create a throwaway inspector session and trigger a pause/resume cycle to
 * consume any lingering Debugger.pause flag on the V8 isolate.  If the flag
 * was already cleared this is a no-op.  Best-effort — never throws.
 */
async function clearPendingPause() {
  const inspector = await import('node:inspector')
  const s = new inspector.Session()
  try {
    s.connect()
    await new Promise<void>((resolve, reject) => {
      s.post('Debugger.enable', (err) => (err ? reject(err) : resolve()))
    })

    await new Promise<void>((resolve) => {
      let done = false
      s.once('Debugger.paused', () => {
        s.post('Debugger.resume', () => {
          done = true
          resolve()
        })
      })
      s.post('Runtime.evaluate', { expression: '1' }, () => {
        // If evaluate didn't trigger a pause (flag already consumed) or
        // errored, nothing more to do.
        if (!done) {
          resolve()
        }
      })
    })
  } catch {
    // Best-effort
  } finally {
    s.disconnect()
  }
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
    // If not yet paused, clear the pending pause flag from Debugger.pause by
    // triggering a pause/resume cycle on a throwaway session.
    const onSessionDead = () => {
      if (paused) {
        tryResume()
      } else {
        clearPendingPause().then(
          () => resumedResolve?.(),
          () => resumedResolve?.(),
        )
      }
    }
    session.once('error', onSessionDead)
    session.once('Inspector.detached', onSessionDead)

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
      // Try to consume the flag via a throwaway session before unblocking.
      clearPendingPause().then(
        () => resumedResolve?.(),
        () => resumedResolve?.(),
      )
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

  // Default to not auto-opening a browser when there's no interactive
  // terminal attached (CI, AI coding agents, etc.), unless the user
  // explicitly forwarded --open.
  if (serverArgs.open === undefined && !process.stdout.isTTY) {
    serverArgs.open = false
  }

  if (debugPort !== undefined) {
    await openDebugger(debugPort, debugBrk)
  }

  const webPort =
    (portArg as number | undefined) ?? cedarConfig.web.port ?? 8910

  // Start the API dev middleware (Vite SSR, no separate HTTP listener).
  // API requests will be handled inline via the web Vite dev server's
  // middleware pipeline.
  const {
    viteServer: apiViteServer,
    close: closeApi,
    handler: apiHandler,
  } = await startApiDevMiddleware()
  const apiAdapter = createServerAdapter(apiHandler)

  // Background jobs, loaded and run in-process via the api Vite server
  // instead of `cedar-jobs work`'s `api/dist`-only loading (see
  // `jobsDevMiddleware.ts`). Returns `null` when the project has no jobs
  // configured.
  const jobsWorkerPool = await startJobsDevWorkers(apiViteServer)

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
  const shutdown = createShutdownHandler({
    close: async () => {
      await devServer.close()
      await jobsWorkerPool?.stop()
      await closeApi()
    },
  })

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
