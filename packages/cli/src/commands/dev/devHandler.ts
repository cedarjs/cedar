import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'

import concurrently from 'concurrently'
import type { Command } from 'concurrently'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { shutdownPort } from '@cedarjs/internal/dist/dev'
import { generateGqlormArtifacts } from '@cedarjs/internal/dist/generate/gqlormSchema'
import { getConfig, getConfigPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../../lib/exit.js'
import { generatePrismaClient } from '../../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'
import { getFreePort } from '../../lib/ports.js'
// @ts-expect-error - Types not available for JS files
import { serverFileExists } from '../../lib/project.js'

import { getApiDebugFlag } from './apiDebugFlag.js'
import { getPackageWatchCommands } from './packageWatchCommands.js'

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

  const serverFile = serverFileExists()

  let apiAvailablePort: number | undefined
  if (workspace.includes('api')) {
    const apiPreferredPort = parseInt(String(getConfig().api.port))
    apiAvailablePort = await getFreePort(apiPreferredPort)

    if (apiAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the api server`,
      })
    }
  }

  let webPreferredPort: number | undefined = parseInt(
    String(getConfig().web.port),
  )
  let webAvailablePort = webPreferredPort
  let webPortChangeNeeded = false

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

    webAvailablePort = await getFreePort(
      webPreferredPort,
      apiAvailablePort !== undefined ? [apiAvailablePort] : [],
    )

    if (webAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the web server`,
      })
    }

    webPortChangeNeeded = webAvailablePort !== webPreferredPort
  }

  // Check for port conflict and exit with message if found
  if (webPortChangeNeeded) {
    const message = [
      'The currently configured port for the development server is',
      'unavailable. Suggested change to your port, which can be changed in',
      'cedar.toml (or redwood.toml):\n',
      ` - Web to use port ${webAvailablePort} instead`,
      'of your currently configured',
      `${webPreferredPort}\n`,
      '\nCannot run the development server until your configured port is',
      'changed or becomes available.',
    ]
      .filter(Boolean)
      .join(' ')

    exitWithError(undefined, { message })
  }

  if (workspace.includes('api')) {
    try {
      await generatePrismaClient({ verbose: false, force: false })
    } catch (e) {
      const message = getErrorMessage(e)
      errorTelemetry(process.argv, `Error generating prisma client: ${message}`)
      console.error(c.error(message))
    }
  }

  if (workspace.includes('web') && webAvailablePort !== undefined) {
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

  // Ensure gqlorm-schema.json exists before Vite starts. Vite resolves the
  // static `import schema from '../../.cedar/gqlorm-schema.json'` in App.tsx
  // almost immediately (~200ms), but cedar-gen-watch doesn't write the file
  // until chokidar's 'ready' event + full DMMF parse (~3-8s later).
  if (
    generate &&
    workspace.includes('web') &&
    getConfig().experimental?.gqlorm?.enabled
  ) {
    try {
      await generateGqlormArtifacts()
    } catch (e) {
      const message = getErrorMessage(e)
      console.error(c.error(`Error generating gqlorm schema: ${message}`))
    }
  }

  const streamingSsrEnabled = getConfig().experimental?.streamingSsr?.enabled

  // @TODO (Streaming) Lot of temporary feature flags for started dev server.
  // Written this way to make it easier to read

  // Disable the new warning in Vite v5 about the CJS build being deprecated
  // so that users don't have to see it every time the dev server starts up.
  process.env.VITE_CJS_IGNORE_WARNING = 'true'

  const rootPackageJsonPath = path.join(cedarPaths.base, 'package.json')
  const rootPackageJson = JSON.parse(
    fs.readFileSync(rootPackageJsonPath, 'utf8'),
  )

  // Determine which dev command to use based on which workspaces are included
  // and which experimental features are enabled.
  //
  // When both api and web are included (the default), use the unified Vite dev
  // server that handles both sides in a single process with true HMR for the
  // API via Vite's SSR environment.
  //
  // When only web is included, fall back to the standalone Vite dev server.
  const buildUnifiedDevCommand = () => {
    if (streamingSsrEnabled) {
      // Streaming SSR has its own dev server setup
      return null
    }

    if (!workspace.includes('api') || !workspace.includes('web')) {
      return null
    }

    if (serverFile) {
      // Custom server files are not supported by the unified dev server
      return null
    }

    if (
      !fs.existsSync(cedarPaths.api.src) ||
      !fs.existsSync(cedarPaths.web.src)
    ) {
      console.log('api.src or web.src does not exist')
      return null
    }

    return [
      `yarn cross-env NODE_ENV=development cedar-unified-dev`,
      `  --port ${webAvailablePort}`,
      `  --apiPort ${apiAvailablePort}`,
      getApiDebugFlag(apiDebugPort, apiAvailablePort),
      forward,
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const unifiedDevCommand = buildUnifiedDevCommand()

  const jobs: (Partial<Command> & {
    name: string
    command: string
    runWhen?: () => boolean
  })[] = []

  if (unifiedDevCommand) {
    // Unified dev mode: one node process handles both web (Vite client) and API
    // (Vite SSR + Fastify) with true HMR – no nodemon, no separate watcher.
    jobs.push({
      name: 'dev',
      command: unifiedDevCommand,

      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: getDevNodeOptions(),
      },
      prefixColor: 'cyan',
      cwd: cedarPaths.web.base,
    })
  } else {
    // Fallback: start api and web as separate processes.
    if (workspace.includes('api')) {
      const isEsm = rootPackageJson.type === 'module'
      const serverWatchCommand = isEsm
        ? `cedarjs-api-server-watch`
        : `cedar-api-server-watch`

      const cedarConfigPath = getConfigPath()

      jobs.push({
        name: 'api',
        command: [
          'yarn nodemon',
          '  --quiet',
          `  --watch "${cedarConfigPath}"`,
          `  --exec "yarn ${serverWatchCommand}`,
          `    --port ${apiAvailablePort}`,
          `    ${getApiDebugFlag(apiDebugPort, apiAvailablePort)}`,
          `    | cedar-log-formatter"`,
        ]
          .join(' ')
          .replace(/\s+/g, ' '),
        env: {
          NODE_ENV: 'development',
          NODE_OPTIONS: getDevNodeOptions(),
        },
        prefixColor: 'cyan',
        runWhen: () => fs.existsSync(cedarPaths.api.src),
      })
    }

    if (workspace.includes('web')) {
      let webCommand = `yarn cross-env NODE_ENV=development cedar-vite-dev ${forward}`

      if (streamingSsrEnabled) {
        webCommand = `yarn cross-env NODE_ENV=development cedar-dev-fe ${forward}`
      }

      jobs.push({
        name: 'web',
        command: webCommand,
        prefixColor: 'blue',
        cwd: cedarPaths.web.base,
        runWhen: () => fs.existsSync(cedarPaths.web.src),
      })
    }
  }

  if (generate) {
    jobs.push({
      name: 'gen',
      command: 'yarn cedar-gen-watch',
      prefixColor: 'green',
    })
  }

  // Extract package workspaces from workspace array pass as argument
  const packageWorkspaces = workspace.filter(
    (w) => w !== 'api' && w !== 'web' && w !== 'gen',
  )

  // Check what was passed as arguments first, before hitting the filesystem as
  // a performance optimization.
  if (packageWorkspaces.length > 0) {
    const hasPackageJsonWorkspaces =
      Array.isArray(rootPackageJson.workspaces) &&
      rootPackageJson.workspaces.some((workspace: string) =>
        workspace.startsWith('packages/'),
      )

    if (hasPackageJsonWorkspaces && fs.existsSync(cedarPaths.packages)) {
      const pkgCommands = await getPackageWatchCommands(packageWorkspaces)
      jobs.push(...pkgCommands)
    }
  }

  // Run jobs that either don't have a runWhen function or have a runWhen
  // function that returns true
  const filteredJobs = jobs.filter((job) => !job.runWhen || job.runWhen())

  // Create a custom output stream that filters empty lines
  class FilterEmptyLinesStream extends Writable {
    private buffer = ''

    _write(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ) {
      this.buffer += chunk.toString()

      // Split on newlines - only process complete lines
      const lines = this.buffer.split('\n')

      // Keep the last element (incomplete line) in the buffer
      this.buffer = lines.pop() || ''

      // Filter and output complete lines
      for (const line of lines) {
        // Strip ANSI escape codes to check the actual content
        // eslint-disable-next-line no-control-regex
        const strippedLine = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')

        // Filter out lines that are just "name | " with optional whitespace
        const isEmptyPrefixLine = /^[^|]+\|\s*$/.test(strippedLine)

        if (!isEmptyPrefixLine) {
          process.stdout.write(line + '\n')
        }
      }

      callback()
    }

    _final(callback: (error?: Error | null) => void) {
      // Flush any remaining buffered content
      if (this.buffer.length > 0) {
        // eslint-disable-next-line no-control-regex
        const strippedLine = this.buffer.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        const isEmptyPrefixLine = /^[^|]+\|\s*$/.test(strippedLine)

        if (!isEmptyPrefixLine) {
          process.stdout.write(this.buffer)
        }
      }

      callback()
    }
  }

  const outputStream = new FilterEmptyLinesStream()

  // TODO: Convert jobs to an array and supply cwd command.
  const { result } = concurrently(filteredJobs, {
    prefix: '{name} |',
    timestampFormat: 'HH:mm:ss',
    handleInput: true,
    outputStream,
  })

  // When the user press Ctrl+C, the terminal sends `SIGINT` to the entire
  // process group. Concurrently's `KillOnSignal` controller catches it and
  // forwards it to the child processes (web, gen, api) but it intentionally
  // suppresses Node's default "exit on SIGINT" behaviour so it can wait for the
  // children to shut down cleanly first.
  // Once all three children exit, `KillOnSignal` remaps their exit codes to `0`
  // (since they were killed by a signal, not a real failure), which causes
  // `result` to resolve rather than reject. The `catch(...)` here then never
  // fires. The `cedar dev` process ends up just sitting here with
  // `process.stdin` still in flowing mode from `handleInput: true`, keeping the
  // event loop alive indefinitely.
  // So we have a `then` handler that cleanly exits the process when `result`
  // resolves.
  result
    .then(() => process.exit(0))
    .catch((e) => {
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
