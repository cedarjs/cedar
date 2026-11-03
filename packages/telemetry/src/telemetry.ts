import { spawn } from 'child_process'
import type { SpawnOptions } from 'child_process'
import os from 'os'
import path from 'path'

import { isVerboseTelemetry } from './payload.js'
import { recordTelemetryAttributes, recordTelemetryError } from './record.js'

/**
 * Quotes a single argument for a Windows shell command string.
 *
 * On Windows we spawn with `shell: true` and a command string, so every
 * argument is re-parsed by the shell. Without quoting, anything containing a
 * space is split: a project at `C:\Users\Ada Lovelace\app` makes node try to
 * load `C:\Users\Ada`, and the process dies with MODULE_NOT_FOUND. The JSON
 * payloads passed below need it too, since they contain double quotes.
 *
 * Follows the usual Windows argument-encoding rules: backslashes immediately
 * before a double quote are doubled, the quote itself is escaped, and trailing
 * backslashes are doubled so they can't escape the closing quote.
 */
export function quoteForWindowsShell(arg: string) {
  let quoted = '"'
  let backslashes = 0

  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1
      continue
    }

    if (char === '"') {
      // Double the run of backslashes before the quote so they aren't read as
      // escapes themselves, then escape the quote
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      quoted += '\\'.repeat(backslashes) + char
    }

    backslashes = 0
  }

  // Trailing backslashes would escape the closing quote, so double them
  return quoted + '\\'.repeat(backslashes * 2) + '"'
}

/**
 * Starts the background process that sends the telemetry events in
 * `.cedar/telemetry/`. It's detached, so the CLI can exit without waiting on
 * the network.
 */
export function spawnSender() {
  // "os.type()" returns 'Windows_NT' on Windows.
  // See https://nodejs.org/docs/latest-v12.x/api/os.html#os_os_type.
  const isWindows = os.type() === 'Windows_NT'
  const verbose = isVerboseTelemetry()
  const stdio: SpawnOptions['stdio'] = verbose
    ? ['ignore', 'inherit', 'inherit']
    : 'ignore'

  const spawnOptions: Partial<SpawnOptions> = isWindows
    ? {
        stdio,
        // The following options run the process in the background without a console window, even though they don't look like they would.
        // See https://github.com/nodejs/node/issues/21825#issuecomment-503766781 for information
        detached: false,
        windowsHide: false,
        shell: true,
      }
    : {
        stdio,
        detached: !verbose,
        windowsHide: true,
      }

  const scriptArgs = [path.join(import.meta.dirname, 'scripts', 'send.js')]

  if (isWindows) {
    // Use command string with empty args array to avoid DEP0190 warning when
    // `shell: true`
    const command = [process.execPath, ...scriptArgs]
      .map(quoteForWindowsShell)
      .join(' ')

    spawn(command, [], spawnOptions).unref()
  } else {
    // Use proper args array when no shell needed
    spawn(process.execPath, scriptArgs, spawnOptions).unref()
  }
}

/**
 * Runs `func` and records how long it took as the `<type>Duration` attribute
 * (in milliseconds) of the current telemetry event
 *
 * @param _argv Unused. Only the command the CLI handler records is sent
 */
export const timedTelemetry = async <T>(
  _argv: string[],
  options: { type: string },
  func: () => T | Promise<T>,
): Promise<T> => {
  const start = Date.now()
  const result = await func()

  recordTelemetryAttributes({
    [`${options.type}Duration`]: Date.now() - start,
  })

  return result
}

/**
 * Records an error for the current telemetry event. Same as
 * `recordTelemetryError()`
 *
 * @param _argv Unused. Only the command the CLI handler records is sent
 */
export const errorTelemetry = async (_argv: string[], error: unknown) => {
  recordTelemetryError(error)
}
