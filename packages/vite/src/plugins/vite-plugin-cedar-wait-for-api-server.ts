import net from 'node:net'

import type { PluginOption, ViteDevServer } from 'vite'

import { getConfig } from '@cedarjs/project-config'

export function cedarWaitForApiServer(): PluginOption {
  const cedarConfig = getConfig()
  const apiPort = cedarConfig.api.port
  const apiHost = cedarConfig.api.host || 'localhost'

  return {
    name: 'cedar-wait-for-api-server',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, _res, next) => {
        const url = req.originalUrl || req.url
        if (!url) {
          return next()
        }

        const apiUrl = cedarConfig.web.apiUrl
        const apiGqlUrl = cedarConfig.web.apiGraphQLUrl

        let shouldWait = false

        if (url.includes('/graphql')) {
          shouldWait = true
        } else if (apiUrl.startsWith('/') && url.startsWith(apiUrl)) {
          shouldWait = true
        } else if (
          apiGqlUrl &&
          apiGqlUrl.startsWith('/') &&
          url.startsWith(apiGqlUrl)
        ) {
          shouldWait = true
        }

        if (shouldWait) {
          try {
            await waitForPort(apiPort, apiHost)
          } catch {
            console.error(
              '[cedar-wait-for-api-server] Timed out waiting for API server ' +
                `at ${apiHost}: ${apiPort}`,
            )
          }
        }

        next()
      })
    },
  }
}

async function waitForPort(port: number, host: string, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const isOpen = await checkPort(port, host)

    if (isOpen) {
      return
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
