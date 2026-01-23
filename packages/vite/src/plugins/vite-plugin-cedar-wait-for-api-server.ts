import net from 'node:net'

import type { PluginOption, ViteDevServer } from 'vite'

import { getConfig } from '@cedarjs/project-config'

let waitingPromise: Promise<void> | null = null
let serverHasBeenUp = false

export function cedarWaitForApiServer(): PluginOption {
  const cedarConfig = getConfig()
  const apiPort = cedarConfig.api.port
  const apiHost = cedarConfig.api.host || 'localhost'

  return {
    name: 'cedar-wait-for-api-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.originalUrl

        const apiUrl = cedarConfig.web.apiUrl.replace(/\/$/, '')
        // By default the GraphQL API URL is apiUrl + '/graphql'. It is
        // however possible to configure it to something completely different,
        // so we have to check it separately
        const apiGqlUrl = cedarConfig.web.apiGraphQLUrl

        const isApiRequest =
          url &&
          (url.startsWith(apiUrl) ||
            // Only match on .../graphql not on .../graphql-foo. That's why I
            // don't use startsWith here
            url === apiGqlUrl ||
            // The two checks below are for when we support GraphQL-over-HTTP
            url.startsWith(apiGqlUrl + '/') ||
            url.startsWith(apiGqlUrl + '?'))

        if (!isApiRequest || serverHasBeenUp) {
          return next()
        }

        try {
          // Reuse existing promise if already waiting
          if (!waitingPromise) {
            waitingPromise = waitForPort(apiPort, apiHost).finally(() => {
              // Clear once resolved (success or failure) so future requests
              // after a timeout can retry
              waitingPromise = null
            })
          }

          await waitingPromise

          // Once we've confirmed that the server is listening for requests we
          // don't want to wait again. This ensures we fail fast and let Vite's
          // regular error handling take over if the server crashes mid-session
          serverHasBeenUp = true
        } catch {
          const message =
            'Vite timed out waiting for the Cedar API server ' +
            `at ${apiHost}:${apiPort}` +
            '\n' +
            'Please manually refresh the page when the server is ready'

          // The `console.error` call here makes the error show in the terminal.
          // The response we send further down makes the error show in the
          // browser.
          console.error(message)

          // This heuristic isn't perfect. It's written to handle dbAuth.
          // But it's very unlikely the user would have code that does
          // this exact request without it being a auth token request.
          // We need this special handling because we don't want the error
          // message below to be used as the auth token.
          const isAuthTokenRequest = url === apiUrl + '/auth?method=getToken'

          const responseBody = {
            errors: [{ message }],
          }

          // drain any incoming request body so the socket isn't left with
          // unread bytes
          req.resume()

          const body = JSON.stringify(responseBody)

          // Use 203 to indicate that the response was modified by a proxy
          res.writeHead(203, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            ...(!isAuthTokenRequest && {
              'Content-Length': Buffer.byteLength(body),
            }),
            Connection: 'close',
          })

          return isAuthTokenRequest ? res.end() : res.end(body)
        }

        next()
      })
    },
  }
}

const ONE_MINUTE_IN_MS = 60000

async function waitForPort(port: number, host: string) {
  const start = Date.now()
  let lastLogTime = Date.now()
  while (Date.now() - start < ONE_MINUTE_IN_MS) {
    const isOpen = await checkPort(port, host)

    if (isOpen) {
      return
    }

    // Only log every 6 seconds, i.e. 10 times per minute
    const now = Date.now()
    if (now - lastLogTime >= 6000) {
      console.log('⏳ Waiting for API server...')
      lastLogTime = now
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error('Timeout waiting for port')
}

function checkPort(port: number, host: string) {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    socket.setTimeout(200)

    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, host)
  })
}
