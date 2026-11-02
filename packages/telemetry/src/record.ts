import diagnosticsChannel from 'node:diagnostics_channel'

import { redactErrorMessage } from './redact.js'

export { redactErrorMessage } from './redact.js'

/**
 * The diagnostics channel telemetry records are published on. Channels are
 * looked up by name across the whole process, so records published through
 * any copy of this package reach the one collector that's subscribed.
 */
export const TELEMETRY_CHANNEL_NAME = 'cedar:telemetry'

export type TelemetryAttributeValue = string | number | boolean

export type TelemetryAttributes = Record<
  string,
  TelemetryAttributeValue | undefined
>

export type TelemetryRecord =
  | { kind: 'attributes'; attributes: TelemetryAttributes }
  | { kind: 'error'; error: unknown }

const channel = diagnosticsChannel.channel(TELEMETRY_CHANNEL_NAME)

/**
 * Records attributes for the telemetry event of the current process. Does
 * nothing when telemetry is disabled.
 *
 * Only record values that can't identify a user or their project: command
 * names, flags and enum-like option values, never names, paths or hosts.
 *
 * @param attributes Key-value pairs to record. `undefined` values are skipped
 */
export function recordTelemetryAttributes(attributes: TelemetryAttributes) {
  if (channel.hasSubscribers) {
    channel.publish({
      kind: 'attributes',
      attributes,
    } satisfies TelemetryRecord)
  }
}

/**
 * Records an error for the telemetry event of the current process. Only a
 * redacted version of the error message is sent, see `redactErrorMessage`.
 * Does nothing when telemetry is disabled.
 */
export function recordTelemetryError(error: unknown) {
  if (channel.hasSubscribers) {
    channel.publish({ kind: 'error', error } satisfies TelemetryRecord)
  }
}

export interface TelemetryCollector {
  attributes: Record<string, TelemetryAttributeValue>
  error: string | undefined
  /** Stops collecting. Records published afterwards are ignored */
  stop: () => void
}

/**
 * Subscribes to the telemetry channel and collects everything recorded on it
 * until `stop()` is called. Later attributes overwrite earlier ones with the
 * same key, and the last recorded error wins.
 */
export function collectTelemetry(): TelemetryCollector {
  const collector: TelemetryCollector = {
    attributes: {},
    error: undefined,
    stop: () => {
      diagnosticsChannel.unsubscribe(TELEMETRY_CHANNEL_NAME, onRecord)
    },
  }

  // Subscribers run inside `channel.publish()`, and Node rethrows what they
  // throw as an uncaught exception, so nothing may escape this function
  function onRecord(message: unknown) {
    try {
      collect(message)
    } catch {
      // A record that can't be collected is left out
    }
  }

  function collect(message: unknown) {
    if (!isTelemetryRecord(message)) {
      return
    }

    if (message.kind === 'attributes') {
      for (const [key, value] of Object.entries(message.attributes)) {
        if (isAttributeValue(value)) {
          collector.attributes[key] = value
        }
      }
    } else {
      collector.error = redactErrorMessage(message.error)
    }
  }

  diagnosticsChannel.subscribe(TELEMETRY_CHANNEL_NAME, onRecord)

  return collector
}

function isTelemetryRecord(message: unknown): message is TelemetryRecord {
  return (
    typeof message === 'object' &&
    message !== null &&
    'kind' in message &&
    (message.kind === 'attributes' || message.kind === 'error')
  )
}

function isAttributeValue(value: unknown): value is TelemetryAttributeValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}
