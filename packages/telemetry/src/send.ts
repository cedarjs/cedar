import fs from 'node:fs'
import path from 'node:path'

import { v4 as uuidv4, validate as validateUUID } from 'uuid'

import { getPaths, getRawConfig } from '@cedarjs/project-config'
import { RWProject } from '@cedarjs/structure/dist/model/RWProject'

import { getTelemetryDir } from './cli.js'
import type { PendingTelemetryEvent } from './cli.js'
import { getTelemetryEnvironment } from './environment.js'
import { postTelemetryPayload } from './payload.js'
import type { TelemetryProject } from './payload.js'

/** How many event files are kept in `.cedar/telemetry/`, sent or not */
const KEPT_EVENT_FILES = 8

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * A sender renames an event file to `<file>.sending` before sending it, so
 * senders running at the same time never send the same event twice. A claim
 * older than this belongs to a sender that died, and is released again.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000
const CLAIM_SUFFIX = '.sending'

/**
 * The project's anonymous telemetry ID, stored in `.cedar/telemetry.txt`.
 * It's replaced with a new random ID once it's more than 24 hours old, so
 * events can't be linked across days.
 */
export function getTelemetryUid() {
  const uidFile = path.join(getPaths().generated.base, 'telemetry.txt')

  try {
    if (
      fs.existsSync(uidFile) &&
      fs.statSync(uidFile).mtimeMs >= Date.now() - ONE_DAY_MS
    ) {
      const storedUid = fs.readFileSync(uidFile, 'utf-8').trim()

      if (validateUUID(storedUid)) {
        return storedUid
      }
    }

    const uid = uuidv4()
    fs.mkdirSync(path.dirname(uidFile), { recursive: true })
    fs.writeFileSync(uidFile, uid)

    return uid
  } catch {
    // Without a writable `.cedar` dir every event gets its own ID
    return uuidv4()
  }
}

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
    const uid = getTelemetryUid()
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

      const sent = await postTelemetryPayload({
        ...event,
        uid,
        environment,
        project,
      })

      // Sent events are kept with a `_` prefix so users can see what was
      // sent. Unsent ones are retried by the next sender
      fs.renameSync(
        claimPath,
        sent ? path.join(telemetryDir, `_${file}`) : filePath,
      )
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
