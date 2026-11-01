import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getConfig } from './config.js'
import { getConfigPath } from './configPath.js'
import { getPaths } from './paths.js'

declare global {
  // eslint-disable-next-line no-var
  var __CEDAR_CLI_TELEMETRY__: boolean | undefined
}

/**
 * The file URL of the project's built OpenTelemetry SDK setup file, or
 * `undefined` when OpenTelemetry is disabled, the current directory is not
 * a Cedar project, or the setup file does not exist.
 *
 * This is the single source of truth for locating the setup file: the
 * `--import` argv entries that `getOTelImportArgs()` builds for child
 * processes and the in-process `import()` performed by process launchers
 * both consume it.
 */
export function getOTelSetupFileUrl(): string | undefined {
  let configPath: string

  try {
    configPath = getConfigPath()
  } catch {
    // No cedar.toml/redwood.toml anywhere up the tree means "not a Cedar
    // project": the launchers that call this also run from inside framework
    // packages during their own test suites. A config file that exists but
    // fails to parse is a different situation — that error propagates from
    // `getConfig()` below instead of silently disabling OTel.
    return undefined
  }

  if (!fs.existsSync(configPath)) {
    return undefined
  }

  const enabled = getConfig().experimental.opentelemetry.enabled

  if (!enabled) {
    return undefined
  }

  const setupFilePath = path.join(getPaths().api.dist, 'opentelemetry.js')

  if (!fs.existsSync(setupFilePath)) {
    console.warn(
      `OpenTelemetry is enabled, but the setup file does not exist at ${setupFilePath}. Run \`cedar experimental setup-opentelemetry\` to generate it.`,
    )

    return undefined
  }

  return pathToFileURL(setupFilePath).href
}

/**
 * The `--import` argv entries that load the project's OpenTelemetry SDK
 * setup file in a child process, or an empty array when OpenTelemetry is
 * disabled.
 *
 * The setup file is the built `api/dist/opentelemetry.js`. `--import` is
 * used rather than `--require` because Cedar apps are `"type": "module"`,
 * and a setup file using top-level await cannot be loaded through
 * `require`. The path is returned as a file URL, which Node resolves as an
 * ESM specifier on every platform.
 *
 * Note that loading the setup file this early only lets instrumentations
 * patch modules that are loaded afterwards through CommonJS
 * (require-in-the-middle). Modules loaded as ESM are only patched when the
 * setup file registers an ESM loader hook (`module.register`), which the
 * generated setup template currently does not do.
 *
 * Returns nothing when the current directory is not a Cedar project: these
 * args are consumed by process launchers (the dev server watcher, the
 * production API server, the job workers), which are also run from inside
 * framework packages during their own test suites.
 */
export function getOTelImportArgs(): string[] {
  const setupFileUrl = getOTelSetupFileUrl()

  return setupFileUrl === undefined ? [] : [`--import=${setupFileUrl}`]
}

/**
 * Quote the `--import` argv entries from `getOTelImportArgs()` for a command
 * string that will be run through a shell (`sh -c` on macOS/Linux,
 * `cmd.exe /s /c` on Windows, as `concurrently` does).
 *
 * On POSIX a single-quoted string protects everything except a single quote
 * itself, which is closed and re-escaped as `'\''`. On Windows `cmd.exe`
 * treats single quotes as literal characters, so double quotes are used
 * there; a double quote cannot appear in a file URL (it is percent-encoded
 * by `pathToFileURL`), which is what these arguments wrap.
 */
export function quoteOTelImportArgs(
  args: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') {
    return args.map((arg) => `"${arg}"`)
  }

  return args.map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`)
}

/**
 * Whether the Cedar CLI's own telemetry has registered a global tracer
 * provider in this process.
 *
 * `cedar serve ...` and friends can run the app's server inside the `cedar`
 * CLI process. When CLI telemetry is active there (the default), the CLI
 * has already called `provider.register()` on a `NodeTracerProvider`, so
 * the app's own setup file cannot become the global provider in the same
 * process: the OTel API rejects the duplicate registration, and the app's
 * spans would end up in the CLI's telemetry exporter instead of the user's
 * collector. In-process importing of the setup file has to be skipped in
 * that case.
 *
 * The flag is only ever set inside the `cedar` CLI process itself, so the
 * child-process paths (`--import` on a fresh `node`) never see it.
 */
export function isCLITelemetryActive(): boolean {
  return globalThis.__CEDAR_CLI_TELEMETRY__ === true
}
