import fs from 'node:fs'
import path from 'node:path'

import { v4 as uuidv4, validate as validateUUID } from 'uuid'

import { getPaths } from '@cedarjs/project-config'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * The project's anonymous telemetry ID, stored in `.cedar/telemetry.txt`.
 * It's replaced with a new random ID once it's more than 24 hours old, so
 * events can only be linked within that 24 hour window. The CLI stores it in
 * each event when the event is created, so an event that is sent later keeps
 * the ID it was created with.
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
