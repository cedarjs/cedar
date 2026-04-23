#!/usr/bin/env node
import { createServer } from 'vite'
import yargsParser from 'yargs-parser'

import { getPaths, getConfig } from '@cedarjs/project-config'

import { startApiDevServer } from './apiDevServer.js'

const rwPaths = getPaths()
const cedarConfig = getConfig()

const startUnifiedDevServer = async () => {
  const configFile = rwPaths.web.viteConfig

  if (!configFile) {
    throw new Error('Could not locate your web/vite.config.{js,ts} file')
  }

  const {
    force: forceOptimize,
    forwardedServerArgs,
    debug,
    port: portArg,
    apiPort: apiPortArg,
  } = yargsParser(process.argv.slice(2), {
    boolean: ['https', 'open', 'strictPort', 'force', 'cors', 'debug'],
    number: ['port', 'apiPort'],
  })

  const webPort =
    (portArg as number | undefined) ?? cedarConfig.web.port ?? 8910
  const apiPort =
    (apiPortArg as number | undefined) ?? cedarConfig.api.port ?? 8911

  // Start the API dev server (Vite SSR + Fastify) first so it's ready
  // before the web dev server tries to proxy requests to it.
  const { close: closeApi } = await startApiDevServer(apiPort)

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
      ...(forwardedServerArgs as Record<string, unknown>),
    },
    logLevel: debug ? 'info' : undefined,
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
