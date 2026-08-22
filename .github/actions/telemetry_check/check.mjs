/* eslint-env node */

import http from 'http'
import path from 'path'

import { exec } from '@actions/exec'

const redirectUrl =
  process.env.CEDAR_REDIRECT_TELEMETRY || process.env.REDWOOD_REDIRECT_TELEMETRY

console.log(`Telemetry is being redirected to ${redirectUrl}`)

const mode = process.argv[process.argv.indexOf('--mode') + 1]

// The two modes exercise two different telemetry senders with different
// payload shapes:
//  - `cca` (create-cedar-app) sends an OpenTelemetry OTLP trace payload
//    (packages/create-cedar-app/src/telemetry.ts) — there's no top-level
//    "command" field, the closest equivalent is a span name.
//  - `cli` (the CLI) sends the legacy, hand-rolled JSON payload built by
//    packages/telemetry/src/sendTelemetry.ts, which does have a "command"
//    field.
function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return `Telemetry payload is not an object. Got: ${JSON.stringify(payload)} (type: ${typeof payload})`
  }

  if (mode === 'cca') {
    const spanNames = (payload.resourceSpans ?? []).flatMap((resourceSpan) =>
      (resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) =>
        (scopeSpan.spans ?? []).map((span) => span.name),
      ),
    )

    if (!spanNames.some((name) => typeof name === 'string' && name)) {
      return `Telemetry payload is missing a non-empty span name. Got: ${JSON.stringify(payload)}`
    }

    return null
  }

  if (!payload.command || typeof payload.command !== 'string') {
    return `Telemetry payload is missing a non-empty "command" field. Got: ${JSON.stringify(payload)}`
  }

  return null
}

// Setup fake telemetry server
const server = http.createServer((req, res) => {
  let data = ''

  req.on('data', (chunk) => {
    data += chunk
  })

  req.on('end', () => {
    res.writeHead(200)
    res.end()
    console.log('Telemetry packet received', data)

    let payload
    try {
      payload = JSON.parse(data)
    } catch (error) {
      console.error('Telemetry payload was not valid JSON:', error)
      process.exit(1)
    }

    const validationError = validatePayload(payload)
    if (validationError) {
      console.error(validationError)
      process.exit(1)
    }

    process.exit(0)
  })
})

// Run the fake telemetry server at the redirected location
const host = redirectUrl.split(':')[1].slice(2)
const port = parseInt(redirectUrl.split(':')[2])
server.listen(port, host, () => {
  console.log(`Telemetry listener is running on http://${host}:${port}`)
})

// Run a command and await output
try {
  let exitCode = 0
  switch (mode) {
    case 'cca':
      exitCode = await exec(
        `yarn node ./packages/create-cedar-app/dist/create-cedar-app.js "../project for telemetry" --typescript true --git false --no-install --pm yarn`,
      )
      if (exitCode) {
        process.exit(1)
      }
      break
    case 'cli':
      exitCode = await exec(`yarn install`, null, {
        cwd: path.join(process.cwd(), '../project for telemetry'),
      })
      if (exitCode) {
        process.exit(1)
      }
      exitCode = await exec(
        `yarn --cwd "../project for telemetry" node ../cedar/packages/cli/dist/index.js info`,
      )
      if (exitCode) {
        process.exit(1)
      }
      break
    default:
      console.error(`Unknown mode: ${mode}`)
      process.exit(1)
  }
} catch (error) {
  console.error(error)
}

// If we didn't hear the telemetry after 2 mins then let's fail
await new Promise((r) => setTimeout(r, 120_000))
console.error('No telemetry response within 120 seconds. Failing...')
process.exit(1)
