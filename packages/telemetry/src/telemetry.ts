import { spawn } from 'child_process'
import type { SpawnOptions } from 'child_process'
import os from 'os'
import path from 'path'

const CMD_META_CHARS_REGEXP = /([()[\]%!^"`<>&|;, *?])/g

/**
 * Escapes a single argument for safe inclusion in a `cmd.exe` command line.
 * This is the well-known algorithm from https://qntm.org/cmd (also used
 * internally by the `cross-spawn` package). It's needed because, below, we
 * build a single command string for `spawn(..., { shell: true })` on
 * Windows — without escaping, content we don't control (CLI args, error
 * messages) could contain quotes or cmd.exe metacharacters and change the
 * meaning of the command that gets run (CWE-78).
 */
export function escapeArgForWindowsShell(arg: string): string {
  // Sequence of backslashes followed by a double quote: double up all the
  // backslashes and escape the double quote
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"')
  // Sequence of backslashes at the end of the string (which will become a
  // double quote next, below): double up all the backslashes
  escaped = escaped.replace(/(\\*)$/, '$1$1')

  // Quote the whole thing, then escape cmd.exe's own metacharacters
  return `"${escaped}"`.replace(CMD_META_CHARS_REGEXP, '^$1')
}

const spawnProcess = (...args: string[]) => {
  // "os.type()" returns 'Windows_NT' on Windows.
  // See https://nodejs.org/docs/latest-v12.x/api/os.html#os_os_type.
  const isWindows = os.type() === 'Windows_NT'

  const spawnOptions: Partial<SpawnOptions> = isWindows
    ? {
        stdio:
          process.env.CEDAR_VERBOSE_TELEMETRY ||
          process.env.REDWOOD_VERBOSE_TELEMETRY
            ? ['ignore', 'inherit', 'inherit']
            : 'ignore',
        // The following options run the process in the background without a console window, even though they don't look like they would.
        // See https://github.com/nodejs/node/issues/21825#issuecomment-503766781 for information
        detached: false,
        windowsHide: false,
        shell: true,
      }
    : {
        stdio:
          process.env.CEDAR_VERBOSE_TELEMETRY ||
          process.env.REDWOOD_VERBOSE_TELEMETRY
            ? ['ignore', 'inherit', 'inherit']
            : 'ignore',
        detached:
          process.env.CEDAR_VERBOSE_TELEMETRY ||
          process.env.REDWOOD_VERBOSE_TELEMETRY
            ? false
            : true,
        windowsHide: true,
      }

  const scriptArgs = [
    path.join(import.meta.dirname, 'scripts', 'invoke.js'),
    ...args,
  ]

  if (isWindows) {
    // Use command string with empty args array to avoid DEP0190 warning when
    // `shell: true`. Escape every argument, since `spawn` will hand this
    // whole string to cmd.exe for parsing.
    const command = [process.execPath, ...scriptArgs]
      .map(escapeArgForWindowsShell)
      .join(' ')
    spawn(command, [], spawnOptions).unref()
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
  if (
    process.env.CEDAR_DISABLE_TELEMETRY ||
    process.env.REDWOOD_DISABLE_TELEMETRY
  ) {
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
  if (
    process.env.CEDAR_DISABLE_TELEMETRY ||
    process.env.REDWOOD_DISABLE_TELEMETRY
  ) {
    return
  }

  spawnProcess('--argv', JSON.stringify(argv), '--error', JSON.stringify(error))
}

// used as yargs middleware when any command is invoked
export const telemetryMiddleware = async () => {
  if (
    process.env.CEDAR_DISABLE_TELEMETRY ||
    process.env.REDWOOD_DISABLE_TELEMETRY
  ) {
    return
  }

  spawnProcess('--argv', JSON.stringify(process.argv))
}
