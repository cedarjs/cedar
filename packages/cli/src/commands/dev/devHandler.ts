import fs from 'node:fs'
import path from 'node:path'
import { argv } from 'node:process'

import concurrently from 'concurrently'
import type { Command } from 'concurrently'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { shutdownPort } from '@cedarjs/internal/dist/dev'
import { getConfig, getConfigPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../../lib/exit.js'
// @ts-expect-error - Types not available for JS files
import { generatePrismaClient } from '../../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'
import { getFreePort } from '../../lib/ports.js'
// @ts-expect-error - Types not available for JS files
import { serverFileExists } from '../../lib/project.js'

import { watchPackagesTask } from './watchPackagesTask.js'

const defaultApiDebugPort = 18911

interface DevHandlerOptions {
  workspace?: string[]
  forward?: string
  generate?: boolean
  apiDebugPort?: number
}

export const handler = async ({
  workspace = ['api', 'web', 'packages/*'],
  forward = '',
  generate = true,
  apiDebugPort,
}: DevHandlerOptions) => {
  recordTelemetryAttributes({
    command: 'dev',
    workspace: JSON.stringify(workspace),
    generate,
  })

  const cedarPaths = getPaths()

  // Extract package workspaces from side array
  const packageWorkspaces = workspace.filter(
    (w) => w !== 'api' && w !== 'web' && w !== 'gen',
  )

  // Check if package workspaces exist in root package.json
  const rootPackageJsonPath = path.join(cedarPaths.base, 'package.json')
  const rootPackageJson = JSON.parse(
    fs.readFileSync(rootPackageJsonPath, 'utf8'),
  )
  const hasPackageWorkspaces =
    Array.isArray(rootPackageJson.workspaces) &&
    rootPackageJson.workspaces.length > 2

  const serverFile = serverFileExists()

  // Starting values of ports from config (redwood.toml)
  const apiPreferredPort = parseInt(String(getConfig().api.port))

  let webPreferredPort: number | undefined = parseInt(
    String(getConfig().web.port),
  )

  // Assume we can have the ports we want
  let apiAvailablePort = apiPreferredPort
  let apiPortChangeNeeded = false
  let webAvailablePort = webPreferredPort
  let webPortChangeNeeded = false

  // Check api port, unless there's a serverFile. If there is a serverFile, we
  // don't know what port will end up being used in the end. It's up to the
  // author of the server file to decide and handle that
  if (workspace.includes('api') && !serverFile) {
    apiAvailablePort = await getFreePort(apiPreferredPort)

    if (apiAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the api server`,
      })
    }

    apiPortChangeNeeded = apiAvailablePort !== apiPreferredPort
  }

  // Check web port
  if (workspace.includes('web')) {
    // Extract any ports the user forwarded to the dev server and prefer that
    // instead
    const forwardedPortMatches = [
      ...forward.matchAll(/\-\-port(\=|\s)(?<port>[^\s]*)/g),
    ]

    if (forwardedPortMatches.length) {
      const port = forwardedPortMatches.pop()?.groups?.port
      webPreferredPort = port ? parseInt(port, 10) : undefined
    }

    webAvailablePort = await getFreePort(webPreferredPort, [
      apiPreferredPort,
      apiAvailablePort,
    ])

    if (webAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the web server`,
      })
    }

    webPortChangeNeeded = webAvailablePort !== webPreferredPort
  }

  // Check for port conflict and exit with message if found
  if (apiPortChangeNeeded || webPortChangeNeeded) {
    const message = [
      'The currently configured ports for the development server are',
      'unavailable. Suggested changes to your ports, which can be changed in',
      'redwood.toml, are:\n',
      apiPortChangeNeeded && ` - API to use port ${apiAvailablePort} instead`,
      apiPortChangeNeeded && 'of your currently configured',
      apiPortChangeNeeded && `${apiPreferredPort}\n`,
      webPortChangeNeeded && ` - Web to use port ${webAvailablePort} instead`,
      webPortChangeNeeded && 'of your currently configured',
      webPortChangeNeeded && `${webPreferredPort}\n`,
      '\nCannot run the development server until your configured ports are',
      'changed or become available.',
    ]
      .filter(Boolean)
      .join(' ')

    exitWithError(undefined, { message })
  }

  if (workspace.includes('api')) {
    try {
      await generatePrismaClient({
        verbose: false,
        force: false,
      })
    } catch (e) {
      const message = getErrorMessage(e)
      errorTelemetry(process.argv, `Error generating prisma client: ${message}`)
      console.error(c.error(message))
    }

    // Again, if a server file is configured, we don't know what port it'll end
    // up using
    if (!serverFile) {
      try {
        await shutdownPort(apiAvailablePort)
      } catch (e) {
        const message = getErrorMessage(e)
        errorTelemetry(process.argv, `Error shutting down "api": ${message}`)
        console.error(
          `Error whilst shutting down "api" port: ${c.error(message)}`,
        )
      }
    }
  }

  if (workspace.includes('web')) {
    try {
      await shutdownPort(webAvailablePort)
    } catch (e) {
      const message = getErrorMessage(e)
      errorTelemetry(process.argv, `Error shutting down "web": ${message}`)
      console.error(
        `Error whilst shutting down "web" port: ${c.error(message)}`,
      )
    }
  }

  const getApiDebugFlag = () => {
    // Passed in flag takes precedence
    if (apiDebugPort) {
      return `--debug-port ${apiDebugPort}`
    } else if (argv.includes('--apiDebugPort')) {
      return `--debug-port ${defaultApiDebugPort}`
    }

    const apiDebugPortInToml = getConfig().api.debugPort
    if (apiDebugPortInToml) {
      return `--debug-port ${apiDebugPortInToml}`
    }

    // Don't pass in debug port flag, unless configured
    return ''
  }

  const cedarConfigPath = getConfigPath()
  const streamingSsrEnabled = getConfig().experimental?.streamingSsr?.enabled

  // @TODO (Streaming) Lot of temporary feature flags for started dev server.
  // Written this way to make it easier to read

  // 1. default: Vite (SPA)
  //
  // Disable the new warning in Vite v5 about the CJS build being deprecated
  // so that users don't have to see it every time the dev server starts up.
  process.env.VITE_CJS_IGNORE_WARNING = 'true'
  let webCommand = `yarn cross-env NODE_ENV=development rw-vite-dev ${forward}`

  // 2. Vite with SSR
  if (streamingSsrEnabled) {
    webCommand = `yarn cross-env NODE_ENV=development rw-dev-fe ${forward}`
  }

  const isEsm = rootPackageJson.type === 'module'
  const serverWatchCommand = isEsm
    ? `cedarjs-api-server-watch`
    : `rw-api-server-watch`

  const jobs: Record<
    string,
    Partial<Command> & {
      name: string
      command: string
      runWhen: () => boolean
    }
  > = {
    api: {
      name: 'api',
      command: [
        'yarn nodemon',
        '  --quiet',
        `  --watch "${cedarConfigPath}"`,
        `  --exec "yarn ${serverWatchCommand}`,
        `    --port ${apiAvailablePort}`,
        `    ${getApiDebugFlag()}`,
        '    | rw-log-formatter"',
      ]
        .join(' ')
        .replace(/\s+/g, ' '),
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: getDevNodeOptions(),
      },
      prefixColor: 'cyan',
      runWhen: () => fs.existsSync(cedarPaths.api.src),
    },
    web: {
      name: 'web',
      command: webCommand,
      prefixColor: 'blue',
      cwd: cedarPaths.web.base,
      runWhen: () => fs.existsSync(cedarPaths.web.src),
    },
    gen: {
      name: 'gen',
      command: 'yarn rw-gen-watch',
      prefixColor: 'green',
      runWhen: () => generate,
    },
    packages: {
      name: 'packages',
      command: async () => {
        const packagesToWatch =
          packageWorkspaces.length > 0 ? packageWorkspaces : ['packages/*']
        await watchPackagesTask(packagesToWatch)
      },
      prefixColor: 'yellow',
      runWhen: () => hasPackageWorkspaces && fs.existsSync(cedarPaths.packages),
    },
  }

  const mappedJobs = Object.keys(jobs).map((job) => {
    // Include the jobs for the workspaces indicated on the command line, plus
    // the gen job and packages job (if packages exist)
    if (workspace.includes(job) || job === 'gen' || job === 'packages') {
      return jobs[job]
    }

    return {
      name: '',
      command: '',
      runWhen: () => false,
    }
  })

  // TODO: Convert jobs to an array and supply cwd command.
  const { result } = concurrently(
    mappedJobs.filter((job) => job.runWhen()),
    {
      prefix: '{name} |',
      timestampFormat: 'HH:mm:ss',
      handleInput: true,
    },
  )

  result.catch((e) => {
    if (e?.message) {
      errorTelemetry(
        process.argv,
        `Error concurrently starting workspaces: ${e.message}`,
      )
      exitWithError(e)
    }
  })
}

/**
 * Gets the value of the `NODE_OPTIONS` env var from `process.env`, appending
 * `--enable-source-maps` if it's not already there.
 * See https://nodejs.org/api/cli.html#node_optionsoptions.
 */
export function getDevNodeOptions() {
  const { NODE_OPTIONS } = process.env
  const enableSourceMapsOption = '--enable-source-maps'

  if (!NODE_OPTIONS) {
    return enableSourceMapsOption
  }

  if (NODE_OPTIONS.includes(enableSourceMapsOption)) {
    return NODE_OPTIONS
  }

  return `${NODE_OPTIONS} ${enableSourceMapsOption}`
}

function getErrorMessage(error: unknown) {
  return error instanceof Object && 'message' in error
    ? error.message
    : String(error)
}
