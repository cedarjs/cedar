import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Writable } from 'node:stream'

import concurrently from 'concurrently'
import type { Command } from 'concurrently'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { formatRunBinCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { shutdownPort } from '@cedarjs/internal/dist/dev'
import { generateGqlormArtifacts } from '@cedarjs/internal/dist/generate/gqlormSchema'
import { getConfig, getConfigPath } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'
import { errorTelemetry } from '@cedarjs/telemetry'

import { exitWithError } from '../../lib/exit.js'
import { generatePrismaClient } from '../../lib/generatePrismaClient.js'
import { getPaths } from '../../lib/index.js'
import { getFreePort } from '../../lib/ports.js'
import { serverFileExists } from '../../lib/project.js'

import { getApiDebugFlag } from './apiDebugFlag.js'
import { getPackageWatchCommands } from './packageWatchCommands.js'

const createdRequire = createRequire(import.meta.url)

interface DevHandlerOptions {
  workspace?: string[]
  forward?: string
  generate?: boolean
  apiDebugPort?: number
  debugBrk?: boolean
  ud?: boolean
  nodeArgs?: string
}

/**
 * Builds the command that launches one of `@cedarjs/vite`'s dev-server bins
 * (`cedar-vite-dev`, `cedar-unified-dev`).
 *
 * We launch the bin via an explicit `node <flags> <binPath>` rather than the
 * package-manager bin shim so node-level CLI flags can be applied.
 * `extraNodeArgs` carries whatever the user passed via `cedar dev
 * --node-args="..."`. The main use is our smoke-test CI passing
 * `--node-args="--no-maglev"` on Windows to dodge V8's Maglev JIT crash
 * (STATUS_STACK_BUFFER_OVERRUN, exit code 3221226505) which otherwise takes down
 * the dev web server mid-run. See https://github.com/nodejs/node/issues/62260
 * and docs/implementation-plans/flaky-smoke-tests-investigation.md. `--no-maglev`
 * is a V8 flag, so it can't go through `NODE_OPTIONS` or the bin shim.
 *
 * Under Yarn we launch with `yarn node` rather than bare `node`: with the PnP
 * linker there is no `node_modules` — the resolved bin path is a virtual path
 * inside a Yarn cache zip, and only `yarn node` loads the PnP runtime needed to
 * resolve the bin's imports and read that path. Under the node-modules linker
 * `yarn node` is just node-in-project. npm and pnpm always have a real
 * `node_modules` tree (pnpm's store is still native `node_modules`), so bare
 * `node` is correct there.
 *
 * `NODE_ENV=development` is set by the caller via the `concurrently` job's `env`
 * (like the api and unified jobs already do), so no `cross-env` wrapper is
 * needed.
 */
function formatViteDevBinCommand(binName: string, extraNodeArgs = '') {
  // `@cedarjs/vite` is a direct dependency of the CLI. If it can't be resolved
  // the install is broken and dev can't run, so fail loudly rather than
  // silently degrade. The `bins/*.mjs` subpaths aren't in `@cedarjs/vite`'s
  // `exports` map, but `./package.json` is, so resolve that and derive the bin
  // path from it.
  let vitePackageJsonPath: string
  try {
    vitePackageJsonPath = createdRequire.resolve('@cedarjs/vite/package.json')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Could not resolve @cedarjs/vite, which the dev server needs to run. ` +
        `Is it installed? (${message})`,
    )
  }

  const binPath = path.join(
    path.dirname(vitePackageJsonPath),
    'bins',
    `${binName}.mjs`,
  )

  const nodeLauncher = getPackageManager() === 'yarn' ? 'yarn node' : 'node'
  const flags = extraNodeArgs ? `${extraNodeArgs} ` : ''

  return `${nodeLauncher} ${flags}"${binPath}"`
}

export const handler = async ({
  workspace = ['api', 'web', 'packages/*'],
  forward = '',
  generate = true,
  apiDebugPort,
  debugBrk,
  ud = false,
  nodeArgs = '',
}: DevHandlerOptions) => {
  recordTelemetryAttributes({
    command: 'dev',
    workspace: JSON.stringify(workspace),
    generate,
  })

  const cedarPaths = getPaths()

  const serverFile = serverFileExists()

  const apiPreferredPort = parseInt(String(getConfig().api.port))
  // This can forward the configured port even though we don't know it's free.
  let apiAvailablePort = apiPreferredPort
  let apiPortChangeNeeded = false

  if (workspace.includes('api') && !serverFile) {
    // Check api port availability. If there's a serverFile we don't know what
    // port will end up being used — it's up to the author to decide.
    apiAvailablePort = await getFreePort(apiPreferredPort)

    if (apiAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the api server`,
      })
    }

    apiPortChangeNeeded = apiAvailablePort !== apiPreferredPort
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
      apiAvailablePort !== undefined
        ? [apiPreferredPort, apiAvailablePort]
        : [apiPreferredPort],
    )

    if (webAvailablePort === -1) {
      exitWithError(undefined, {
        message: `Could not determine a free port for the web server`,
      })
    }

    webPortChangeNeeded = webAvailablePort !== webPreferredPort
  }

  // Check for port conflict and exit with message if found
  if (ud) {
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
  } else {
    if (apiPortChangeNeeded || webPortChangeNeeded) {
      const message = [
        'The currently configured ports for the development server are',
        'unavailable. Suggested changes to your ports, which can be changed in',
        'cedar.toml (or redwood.toml), are:\n',
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
  }

  if (workspace.includes('api')) {
    if (generate) {
      try {
        await generatePrismaClient({ verbose: false })
      } catch (e) {
        const message = getErrorMessage(e)
        errorTelemetry(
          process.argv,
          `Error generating prisma client: ${message}`,
        )
        console.error(c.error(message))
      }
    }

    if (!ud && !serverFile) {
      if (typeof apiAvailablePort === 'undefined' || apiAvailablePort === -1) {
        exitWithError(undefined, {
          message: `Could not determine a free port for the api server`,
        })
      }

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
    if (!ud) {
      return null
    }

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
      formatViteDevBinCommand('cedar-unified-dev', nodeArgs),
      `  --port ${webAvailablePort}`,
      `  --apiPort ${apiAvailablePort}`,
      getApiDebugFlag(apiDebugPort, apiAvailablePort),
      debugBrk ? '--debug-brk' : '',
      forward,
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const unifiedDevCommand = buildUnifiedDevCommand()

  // In fallback (non-unified) mode the web Vite dev server proxy targets the
  // configured API port. If the API silently binds to a different free port,
  // all proxied API requests will fail with no diagnostic output.
  if (!unifiedDevCommand && apiPortChangeNeeded) {
    const message = [
      'The currently configured port for the development server is',
      'unavailable. Suggested change to your port, which can be changed in',
      'cedar.toml (or redwood.toml):\n',
      ` - API to use port ${apiAvailablePort} instead`,
      'of your currently configured',
      `${apiPreferredPort}\n`,
      '\nCannot run the development server until your configured port is',
      'changed or becomes available.',
    ]
      .filter(Boolean)
      .join(' ')

    exitWithError(undefined, { message })
  }

  const jobs: (Partial<Command> & {
    name: string
    command: string
    runWhen?: () => boolean
  })[] = []

  if (unifiedDevCommand) {
    // Unified dev mode: one node process handles both web (Vite client) and API
    // (Vite SSR + Fastify in-process) with true HMR – no nodemon, no separate watcher.
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
        command: formatRunBinCommand('nodemon', [
          '--quiet',
          `--watch "${cedarConfigPath}"`,
          `--exec "${formatRunBinCommand(serverWatchCommand)} ` +
            `--port ${apiAvailablePort} ` +
            `${getApiDebugFlag(apiDebugPort, apiAvailablePort)} ` +
            `| ${formatRunBinCommand('cedar-log-formatter')}"`,
        ]),
        env: {
          NODE_ENV: 'development',
          NODE_OPTIONS: getDevNodeOptions(),
        },
        prefixColor: 'cyan',
        runWhen: () => fs.existsSync(cedarPaths.api.src),
      })
    }

    if (workspace.includes('web')) {
      let webCommand = `${formatViteDevBinCommand('cedar-vite-dev', nodeArgs)} ${forward}`

      if (streamingSsrEnabled) {
        // TODO: `cedar-dev-fe` (streaming SSR) is a compiled `dist/` entry, not
        // a `bins/*.mjs`, so it isn't covered by the explicit-launch /
        // `--node-args` handling yet. See the investigation doc's follow-ups.
        webCommand = `${formatRunBinCommand('cedar-dev-fe')} ${forward}`
      }

      jobs.push({
        name: 'web',
        command: webCommand,
        env: {
          NODE_ENV: 'development',
        },
        prefixColor: 'blue',
        cwd: cedarPaths.web.base,
        runWhen: () => fs.existsSync(cedarPaths.web.src),
      })
    }
  }

  if (generate) {
    jobs.push({
      name: 'gen',
      command: formatRunBinCommand('cedar-gen-watch'),
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
