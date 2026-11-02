import type { TelemetryAttributeValue } from './record.js'

/** Where telemetry events are sent unless `CEDAR_REDIRECT_TELEMETRY` is set */
export const DEFAULT_TELEMETRY_URL = 'https://telemetry.cedarjs.com'

export function getTelemetryUrl() {
  return (
    process.env.CEDAR_REDIRECT_TELEMETRY ||
    process.env.REDWOOD_REDIRECT_TELEMETRY ||
    DEFAULT_TELEMETRY_URL
  )
}

export function isVerboseTelemetry() {
  return Boolean(
    process.env.CEDAR_VERBOSE_TELEMETRY ||
    process.env.REDWOOD_VERBOSE_TELEMETRY,
  )
}

/**
 * Information about the machine and tooling a telemetry event came from.
 * Nothing in here identifies a user.
 */
export interface TelemetryEnvironment {
  osType: string | undefined
  osVersion: string | undefined
  shell: string | undefined
  nodeVersion: string | undefined
  yarnVersion: string | undefined
  npmVersion: string | undefined
  vscodeVersion: string | undefined
  cpuCount: number
  memoryGb: number
  nodeEnv: string | undefined
  /** Whether this ran in a CI environment */
  ci: boolean
  /** Whether this ran in Cedar's own CI */
  cedarCi: boolean
  /** A known cloud development environment, like `gitpod` */
  devEnvironment: string | undefined
}

/** Size and shape of the Cedar project an event came from */
export interface TelemetryProject {
  /** Counts of routes, prerendered routes, services, cells and pages */
  complexity: string
  sides: string[]
  /** The keys of the `[experimental]` sections in `cedar.toml` */
  experiments: string[]
}

/**
 * One telemetry event, as sent to the telemetry endpoint. `command` events
 * come from the `cedar` CLI, one per CLI run, and `create` events come from
 * `create-cedar-app` and `create-cedar-rsc-app`.
 */
export interface TelemetryPayload {
  type: 'command' | 'create'
  /**
   * A random ID that is replaced once it's 24 hours old. It only lets events
   * from the same project within that 24 hour window be grouped together
   */
  uid: string
  /** When the command started, as an ISO 8601 string */
  timestamp: string
  /**
   * The command that ran, described from its definition, like
   * `generate page [name] [path] --force`. Values the user typed are
   * replaced by placeholders named after their argument or option
   */
  command: string | undefined
  durationMs: number
  /** Flags and option values the command recorded */
  attributes: Record<string, TelemetryAttributeValue>
  /** The first line of the error message, with file paths removed */
  error: string | undefined
  /** The version of the package that sent the event */
  cedarVersion: string
  environment: TelemetryEnvironment
  /** Not included for `create` events */
  project: TelemetryProject | undefined
}

/**
 * POSTs a telemetry event as JSON. Never throws: telemetry must not break
 * whatever it's measuring.
 *
 * @returns Whether the endpoint accepted the event
 */
export async function postTelemetryPayload(
  payload: TelemetryPayload,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
) {
  const verbose = isVerboseTelemetry()

  if (verbose) {
    console.info('Cedar telemetry payload', payload)
  }

  try {
    const response = await fetch(getTelemetryUrl(), {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (verbose && !response.ok) {
      console.error(
        `Cedar telemetry endpoint responded with ${response.status}:`,
        await response.text(),
      )
    }

    return response.ok
  } catch (error) {
    if (verbose) {
      console.error('Cedar telemetry could not be sent:', error)
    }

    return false
  }
}
