import ci from 'ci-info'
import fetch from 'node-fetch'

const TELEMETRY_URL =
  process.env.CEDAR_REDIRECT_TELEMETRY ??
  process.env.REDWOOD_REDIRECT_TELEMETRY ??
  'https://telemetry.redwoodjs.com/api/v1/telemetry'

export interface TelemetryInfo {
  template?: string
}

// Note: The fields and their names are constrained by the telemetry API
interface TelemetryPayload {
  cedarCi: boolean
  ci: boolean
  command: string
  complexity: string
  duration: number
  error?: string
  experiments?: string[]
  system: string
  type: 'command'
}

function buildPayload(
  telemetryInfo: TelemetryInfo,
  duration: number,
): TelemetryPayload {
  const command = ['create', 'cedar-rsc-app']
  if (process.argv.includes('--no-check-latest')) {
    command.push('--no-check-latest')
  }

  // We don't have a field for the template, so we're using/abusing the experiments field
  const experiments: string[] = []
  if (telemetryInfo.template) {
    experiments.push(`template:${telemetryInfo.template}`)
  }

  // Detect CI environments
  const isCi = ci.isCI
  const isCedarCi = !!process.env.CEDAR_CI

  // Note: The complexity field is required by the API so we are using a placeholder value
  const complexity = '-1.-1.-1.-1.-1'

  // Note: The system field is required by the API so we are using a placeholder value
  const system = '-1.-1'

  return {
    ci: isCi,
    command: command.join(' '),
    complexity,
    duration,
    experiments,
    cedarCi: isCedarCi,
    system,
    type: 'command',
  }
}

export async function sendTelemetry(
  telemetryInfo: TelemetryInfo,
  duration: number,
) {
  if (
    process.env.CEDAR_DISABLE_TELEMETRY ||
    process.env.REDWOOD_DISABLE_TELEMETRY
  ) {
    return
  }

  const verboseTelemetry =
    process.env.CEDAR_VERBOSE_TELEMETRY ?? process.env.REDWOOD_VERBOSE_TELEMETRY

  try {
    const payload = buildPayload(telemetryInfo, duration)

    if (verboseTelemetry) {
      console.info('Cedar Telemetry Payload', payload)
    }

    const response = await fetch(TELEMETRY_URL, {
      method: 'post',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    })

    if (verboseTelemetry) {
      console.info('Cedar Telemetry Response:', response)
    }

    // Normally we would report on any non-error response here (like a 500)
    // but since the process is spawned and stdout/stderr is ignored, it can
    // never be seen by the user, so ignore.
    if (verboseTelemetry && response.status !== 200) {
      console.error('Error from telemetry insert:', await response.text())
    }
  } catch (e) {
    // service interruption: network down or telemetry API not responding
    // don't let telemetry errors bubble up to user, just do nothing.
    if (verboseTelemetry) {
      console.error('Uncaught error in telemetry:', e)
    }
  }
}
