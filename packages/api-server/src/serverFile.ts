import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

import type { APIParsedOptions } from './types.js'

/**
 * Path to a project's built custom server file, if it has one.
 *
 * This checks `api/dist/server.js` — the built output — not
 * `api/src/server.{ts,js}`, which is what `@cedarjs/cli`'s own
 * `serverFileExists()` checks. A production install typically ships only
 * `api/dist`, so checking source would return false in exactly the
 * situation this needs to catch.
 */
export function apiDistServerFilePath(): string {
  return path.join(getPaths().api.dist, 'server.js')
}

export function apiDistServerFileExists(): boolean {
  return fs.existsSync(apiDistServerFilePath())
}

/**
 * Run a project's custom `api/dist/server.js` instead of the default Fastify
 * server.
 *
 * Reimplements what `@cedarjs/cli`'s `apiServerFileHandler` does for
 * `cedar serve api`, rather than importing it — `@cedarjs/cli` pulls in its
 * whole build/dev toolchain, which is exactly what a production install of
 * this package needs to stay clear of.
 */
export async function runApiDistServerFile(
  options: APIParsedOptions = {},
): Promise<void> {
  const args = ['--apiRootPath', options.apiRootPath ?? '/']

  if (options.port) {
    args.push('--apiPort', String(options.port))
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [apiDistServerFilePath(), ...args], {
      cwd: getPaths().api.dist,
      stdio: 'inherit',
    })

    child.on('error', reject)

    child.on('exit', (code, signal) => {
      // A signal means something else killed it (e.g. Ctrl-C) — that's a
      // normal way for a long-running server to stop, not a failure.
      if (signal || code === 0) {
        resolve()
        return
      }

      reject(new Error(`api/dist/server.js exited with code ${code}`))
    })
  })
}
