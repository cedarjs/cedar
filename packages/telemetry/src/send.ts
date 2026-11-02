import fs from 'node:fs'
import path from 'node:path'

import { getRawConfig } from '@cedarjs/project-config'
import { RWProject } from '@cedarjs/structure/dist/model/RWProject'

import { getTelemetryDir } from './cli.js'
import type { PendingTelemetryEvent } from './cli.js'
import { getTelemetryEnvironment } from './environment.js'
import { postTelemetryPayload } from './payload.js'
import type { TelemetryProject } from './payload.js'

/** How many event files are kept in `.cedar/telemetry/`, sent or not */
const KEPT_EVENT_FILES = 8

/**
 * A sender renames an event file to `<file>.sending` before sending it, so
 * senders running at the same time never send the same event twice. A claim
 * older than this belongs to a sender that died, and is released again.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000
const CLAIM_SUFFIX = '.sending'

export function getTelemetryProject(): TelemetryProject | undefined {
  try {
    const project = new RWProject()
    const routes = project.getRouter().routes
    const prerenderedRoutes = routes.filter((route) => route.hasPrerender)

    // Only the top level `[experimental.X]` keys, not any nested sections
    const experimental: unknown = getRawConfig()['experimental']
    const experiments =
      typeof experimental === 'object' && experimental !== null
        ? Object.keys(experimental)
        : []

    return {
      complexity: [
        routes.length,
        prerenderedRoutes.length,
        project.services.length,
        project.cells.length,
        project.pages.length,
      ].join('.'),
      sides: project.sides,
      experiments,
    }
  } catch {
    return undefined
  }
}

function isPendingEvent(value: unknown): value is PendingTelemetryEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'uid' in value &&
    typeof value.uid === 'string' &&
    'timestamp' in value &&
    'durationMs' in value &&
    'attributes' in value &&
    'cedarVersion' in value
  )
}

/**
 * The timestamp in an event file's name (`<time>-<pid>.json`), with or
 * without the `_` prefix
 */
function fileTime(file: string) {
  return parseInt(file.replace(/^_/, ''), 10) || 0
}

/**
 * Sends every unsent event in `.cedar/telemetry/`. Sent files get a `_`
 * prefix, and files that fail to send are retried next time. Only the
 * newest event files are kept, so users can see what was sent.
 */
export async function sendPendingTelemetry() {
  const telemetryDir = getTelemetryDir()

  if (!fs.existsSync(telemetryDir)) {
    return
  }

  releaseStaleClaims(telemetryDir)

  const pendingFiles = fs
    .readdirSync(telemetryDir)
    .filter((file) => file.endsWith('.json') && !file.startsWith('_'))

  if (pendingFiles.length > 0) {
    const environment = await getTelemetryEnvironment()
    const project = getTelemetryProject()

    for (const file of pendingFiles) {
      const filePath = path.join(telemetryDir, file)
      const claimPath = filePath + CLAIM_SUFFIX

      try {
        // Fails if another sender already claimed this file
        fs.renameSync(filePath, claimPath)
        const now = new Date()
        fs.utimesSync(claimPath, now, now)
      } catch {
        continue
      }

      let event: unknown

      try {
        event = JSON.parse(fs.readFileSync(claimPath, 'utf-8'))
      } catch {
        event = undefined
      }

      if (!isPendingEvent(event)) {
        fs.rmSync(claimPath, { force: true })
        continue
      }

      const payload = { ...event, environment, project }
      const sent = await postTelemetryPayload(payload)

      if (sent) {
        // Sent events are kept with a `_` prefix, exactly as they were sent,
        // so users can see what was sent
        fs.writeFileSync(
          path.join(telemetryDir, `_${file}`),
          JSON.stringify(payload, null, 2),
        )
        fs.rmSync(claimPath, { force: true })
      } else {
        // Unsent events are retried by the next sender
        fs.renameSync(claimPath, filePath)
      }
    }
  }

  const files = fs
    .readdirSync(telemetryDir)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => fileTime(b) - fileTime(a))

  for (const file of files.slice(KEPT_EVENT_FILES)) {
    fs.rmSync(path.join(telemetryDir, file), { force: true })
  }
}

function releaseStaleClaims(telemetryDir: string) {
  for (const file of fs.readdirSync(telemetryDir)) {
    if (!file.endsWith(CLAIM_SUFFIX)) {
      continue
    }

    const claimPath = path.join(telemetryDir, file)

    try {
      if (fs.statSync(claimPath).mtimeMs < Date.now() - STALE_CLAIM_MS) {
        fs.renameSync(claimPath, claimPath.slice(0, -CLAIM_SUFFIX.length))
      }
    } catch {
      // Another sender released or finished it first
    }
  }
}
