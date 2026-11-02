import { v4 as uuidv4 } from 'uuid'

import {
  collectTelemetry,
  getTelemetryEnvironment,
  postTelemetryPayload,
  recordTelemetryError,
} from '@cedarjs/telemetry'
import type { TelemetryCollector } from '@cedarjs/telemetry'

import pkgJson from '../package.json' with { type: 'json' }

export { recordTelemetryAttributes } from '@cedarjs/telemetry'

/**
 * The new app's first anonymous telemetry ID. It's written to the app's
 * `.cedar/telemetry.txt`, where the Cedar CLI replaces it after 24 hours.
 */
export const UID = uuidv4()

let collector: TelemetryCollector | undefined
let startTime = 0

export async function startTelemetry(): Promise<void> {
  collector = collectTelemetry()
  startTime = Date.now()

  process.on('SIGTERM', async () => {
    await shutdownTelemetry()
  })
}

/** Sends the telemetry event for this run. Safe to call more than once */
export async function shutdownTelemetry(): Promise<void> {
  if (!collector) {
    return
  }

  const { attributes, error } = collector
  collector.stop()
  collector = undefined

  await postTelemetryPayload({
    type: 'create',
    uid: UID,
    timestamp: new Date(startTime).toISOString(),
    command: 'create cedar-app',
    durationMs: Date.now() - startTime,
    attributes,
    error,
    cedarVersion: pkgJson.version,
    environment: await getTelemetryEnvironment(),
    project: undefined,
  })
}

export function recordErrorViaTelemetry(error: unknown): void {
  recordTelemetryError(error)
}
