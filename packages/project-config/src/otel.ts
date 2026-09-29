import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getConfig } from './config.js'
import { getPaths } from './paths.js'

/**
 * The `--import` argv entries that load the project's OpenTelemetry SDK
 * setup file in a child process, or an empty array when OpenTelemetry is
 * disabled.
 *
 * The setup file is the built `api/dist/opentelemetry.js`. Preloading it via
 * `--import` (rather than `--require`) is the ESM-correct flag: Cedar apps
 * are `"type": "module"`, and a setup file using top-level await cannot be
 * loaded through `require`. The path is returned as a file URL, which Node
 * resolves as an ESM specifier on every platform.
 *
 * Returns nothing when the current directory is not a Cedar project: these
 * args are consumed by process launchers (the dev server watcher, the
 * production API server, the job workers), which are also run from inside
 * framework packages during their own test suites.
 */
export function getOTelImportArgs(): string[] {
  let enabled
  try {
    enabled = getConfig().experimental.opentelemetry.enabled
  } catch {
    return []
  }

  if (!enabled) {
    return []
  }

  const setupFilePath = path.join(getPaths().api.dist, 'opentelemetry.js')

  if (!fs.existsSync(setupFilePath)) {
    console.warn(
      `OpenTelemetry is enabled, but the setup file does not exist at ${setupFilePath}. Run \`cedar experimental setup-opentelemetry\` to generate it.`,
    )

    return []
  }

  return [`--import=${pathToFileURL(setupFilePath).href}`]
}
