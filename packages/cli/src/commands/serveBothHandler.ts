import path from 'path'

import concurrently from 'concurrently'
import execa from 'execa'

import { handler as apiServerHandler } from '@cedarjs/api-server/cjs/apiCliConfigHandler'
import {
  getAPIHost,
  getAPIPort,
  getWebHost,
  getWebPort,
} from '@cedarjs/api-server/cjs/cliHelpers'
import { getConfig, getPaths } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../lib/exit.js'

type ServeBothArgv = {
  apiRootPath?: string
  apiHost?: string
  apiPort?: number
  webHost?: string
  webPort?: number
}

export const bothServerFileHandler = async (argv: ServeBothArgv) => {
  if (
    getConfig().experimental?.rsc?.enabled ||
    getConfig().experimental?.streamingSsr?.enabled
  ) {
    logSkippingFastifyWebServer()

    await execa('yarn', ['rw-serve-fe'], {
      cwd: getPaths().web.base,
      stdio: 'inherit',
    })
  } else {
    argv.apiPort ??= getAPIPort()
    argv.apiHost ??= getAPIHost()
    argv.webPort ??= getWebPort()
    argv.webHost ??= getWebHost()

    const apiProxyTarget = [
      'http://',
      argv.apiHost.includes(':') ? `[${argv.apiHost}]` : argv.apiHost,
      ':',
      argv.apiPort,
      argv.apiRootPath,
    ].join('')

    const { result } = concurrently(
      [
        {
          name: 'api',
          command: `yarn node ${path.join('dist', 'server.js')} --apiPort ${
            argv.apiPort
          } --apiHost ${argv.apiHost} --apiRootPath ${argv.apiRootPath}`,
          cwd: getPaths().api.base,
          prefixColor: 'cyan',
        },
        {
          name: 'web',
          command: `yarn rw-web-server --port ${argv.webPort} --host ${argv.webHost} --api-proxy-target ${apiProxyTarget}`,
          cwd: getPaths().base,
          prefixColor: 'blue',
        },
      ],
      {
        prefix: '{name} |',
        timestampFormat: 'HH:mm:ss',
        handleInput: true,
      },
    )

    try {
      await result
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : undefined

      if (typeof message !== 'undefined') {
        errorTelemetry(
          process.argv,
          `Error concurrently starting sides: ${message}`,
        )
        exitWithError(error)
      }
    }
  }
}

export const bothSsrRscServerHandler = async (
  argv: ServeBothArgv,
  rscEnabled?: boolean,
) => {
  const apiPromise = apiServerHandler({
    apiRootPath: argv.apiRootPath,
    host: argv.apiHost,
    port: argv.apiPort,
  })

  // TODO (RSC): More gracefully handle Ctrl-C
  // Right now you get a big red error box when you kill the process
  const fePromise = execa('yarn', ['rw-serve-fe'], {
    cwd: getPaths().web.base,
    stdio: 'inherit',
    env: rscEnabled
      ? ({
          ...process.env,
          // TODO (RSC): Is this how we want to do it? If so, we need to find a way
          // to merge this with users' NODE_OPTIONS
          NODE_OPTIONS: '--conditions react-server',
        } as any)
      : undefined,
  })

  await Promise.all([apiPromise, fePromise])
}

function logSkippingFastifyWebServer() {
  console.warn('')
  console.warn('⚠️ Skipping Fastify web server ⚠️')
  console.warn('⚠️ Using new RSC server instead ⚠️')
  console.warn('')
}
