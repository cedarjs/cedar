import { spawn } from 'child_process'
import type { SpawnOptions } from 'child_process'
import os from 'os'
import path from 'path'

import { getPaths } from '@cedarjs/project-config'

const spawnProcess = (...args: string[]) => {
  // "os.type()" returns 'Windows_NT' on Windows.
  // See https://nodejs.org/docs/latest-v12.x/api/os.html#os_os_type.
  const isWindows = os.type() === 'Windows_NT'
  const execPath = isWindows ? `"${process.execPath}"` : process.execPath

  const spawnOptions: Partial<SpawnOptions> = isWindows
    ? {
        stdio: process.env.REDWOOD_VERBOSE_TELEMETRY
          ? ['ignore', 'inherit', 'inherit']
          : 'ignore',
        // The following options run the process in the background without a console window, even though they don't look like they would.
        // See https://github.com/nodejs/node/issues/21825#issuecomment-503766781 for information
        detached: false,
        windowsHide: false,
        shell: true,
      }
    : {
        stdio: process.env.REDWOOD_VERBOSE_TELEMETRY
          ? ['ignore', 'inherit', 'inherit']
          : 'ignore',
        detached: process.env.REDWOOD_VERBOSE_TELEMETRY ? false : true,
        windowsHide: true,
      }

  const scriptArgs = [
    path.join(__dirname, 'scripts', 'invoke.js'),
    ...args,
    '--root',
    getPaths().base,
  ]

  if (isWindows) {
    // Use command string with empty args array to avoid DEP0190 warning when
    // `shell: true`
    spawn([execPath, ...scriptArgs].join(' '), [], spawnOptions).unref()
  } else {
    // Use proper args array when no shell needed
    spawn(process.execPath, scriptArgs, spawnOptions).unref()
  }
}

// wrap a function in this call to get a telemetry hit including how long it took
export const timedTelemetry = async (
  argv: string[],
  options: Record<string, unknown>,
  func: (...args: any[]) => any,
) => {
  if (process.env.REDWOOD_DISABLE_TELEMETRY) {
    return func.call(this)
  }

  const start = new Date()
  const result = await func.call(this)
  const duration = new Date().getTime() - start.getTime()

  spawnProcess(
    '--argv',
    JSON.stringify(argv),
    '--duration',
    duration.toString(),
    '--type',
    JSON.stringify(options.type),
  )

  return result
}

export const errorTelemetry = async (argv: string[], error: any) => {
  if (process.env.REDWOOD_DISABLE_TELEMETRY) {
    return
  }

  spawnProcess('--argv', JSON.stringify(argv), '--error', JSON.stringify(error))
}

// used as yargs middleware when any command is invoked
export const telemetryMiddleware = async () => {
  if (process.env.REDWOOD_DISABLE_TELEMETRY) {
    return
  }

  spawnProcess('--argv', JSON.stringify(process.argv))
}
