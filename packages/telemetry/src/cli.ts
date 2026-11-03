import fs from 'node:fs'
import path from 'node:path'

import { hideBin } from 'yargs/helpers'

import { getPaths } from '@cedarjs/project-config'

import { commandForTelemetry } from './commandForTelemetry.js'
import { isVerboseTelemetry } from './payload.js'
import type { TelemetryPayload } from './payload.js'
import { collectTelemetry } from './record.js'
import type { TelemetryCollector } from './record.js'
import { spawnSender } from './telemetry.js'
import { getTelemetryUid } from './uid.js'

/**
 * A telemetry event as the CLI writes it to `.cedar/telemetry/`. The
 * background sender adds the fields that are slow to compute before sending
 */
export type PendingTelemetryEvent = Omit<
  TelemetryPayload,
  'environment' | 'project'
>

let collector: TelemetryCollector | undefined
let startTime = 0
let cedarVersion = ''
let isShutdown = false
let describedCommand: string | undefined

export function getTelemetryDir() {
  return path.join(getPaths().generated.base, 'telemetry')
}

/**
 * Starts collecting telemetry for this CLI run. Everything recorded with
 * `recordTelemetryAttributes()` and `recordTelemetryError()` until
 * `shutdownTelemetry()` (or process exit) becomes one event.
 */
export function startTelemetry(options: { cedarVersion: string }) {
  if (collector) {
    return
  }

  collector = collectTelemetry()
  startTime = Date.now()
  cedarVersion = options.cedarVersion

  // Without any listeners for these signals, Node terminates the process
  // without emitting `exit`, so the `exit` handler below wouldn't run. The
  // listener either exits, or leaves the signal to another handler if one
  // has been added. Storybook handles its own signals and emits
  // `shutdown-telemetry` instead.
  const cleanArgv = hideBin(process.argv)

  if (!cleanArgv.includes('sb') && !cleanArgv.includes('storybook')) {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
      process.on(signal, () => {
        if (process.listenerCount(signal) === 1) {
          process.exit()
        }
      })
    }
  } else {
    process.on('shutdown-telemetry', () => {
      shutdownTelemetry()
    })
  }

  process.on('exit', () => {
    shutdownTelemetry()
  })
}

/**
 * yargs middleware that describes the running command for the telemetry
 * event, e.g. `generate page [name] [path] --force`. See
 * `commandForTelemetry`.
 */
export function telemetryMiddleware(
  argv: Record<string, unknown>,
  yargs: unknown,
) {
  describedCommand = commandForTelemetry(argv, yargs, hideBin(process.argv))
}

/**
 * Stops collecting, writes the event to `.cedar/telemetry/` and starts a
 * background process that sends it, so the CLI doesn't wait on the network.
 * Synchronous, so it can run in an `exit` handler.
 */
export function shutdownTelemetry() {
  if (!collector || isShutdown) {
    return
  }

  isShutdown = true
  collector.stop()

  try {
    const { command, ...attributes } = collector.attributes

    const event: PendingTelemetryEvent = {
      type: 'command',
      uid: getTelemetryUid(),
      timestamp: new Date(startTime).toISOString(),
      // The command a handler records is only used when the middleware
      // didn't run, e.g. for `--version` and `--help`
      command:
        describedCommand ??
        (command === undefined ? undefined : String(command)),
      durationMs: Date.now() - startTime,
      attributes,
      error: collector.error,
      cedarVersion,
    }

    const telemetryDir = getTelemetryDir()
    fs.mkdirSync(telemetryDir, { recursive: true })
    // The pid keeps CLI runs that start in the same millisecond apart
    const eventPath = path.join(
      telemetryDir,
      `${startTime}-${process.pid}.json`,
    )
    // Senders only read `.json` files, so the event is written under another
    // name first. That way a sender never reads a partly written event
    const tempPath = `${eventPath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(event, null, 2))
    fs.renameSync(tempPath, eventPath)

    spawnSender()
  } catch (error) {
    if (isVerboseTelemetry()) {
      console.error('Cedar telemetry error:', error)
    }
  }
}
