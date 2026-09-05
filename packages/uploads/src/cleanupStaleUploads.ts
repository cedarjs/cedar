import { resolveTarget } from './targets.js'
import type { StorageTargets, UploadDatabase } from './types.js'

const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR

export interface CleanupStaleUploadsOptions {
  db: UploadDatabase
  targets: StorageTargets
  /**
   * Rows still `pending` after this many milliseconds are claimed as
   * `failed`. Defaults to one hour, well past the five-minute validity of a
   * presigned upload URL.
   */
  olderThan?: number
  /**
   * `failed` rows younger than this many milliseconds are re-checked and
   * their bytes deleted if they landed after the claim. Defaults to one day.
   */
  retryWindow?: number
  /** Largest batch of rows to process per call. Defaults to 500. */
  batchSize?: number
}

export interface CleanupStaleUploadsResult {
  /** Rows moved from `pending` to `failed` by this run. */
  claimed: number
  /** Objects deleted from storage by this run. */
  deleted: number
}

/**
 * Sweeps stale uploads. Presigned uploads that were issued but never
 * completed, and route uploads that crashed between row creation and write,
 * leave `pending` rows behind. This claims them with a conditional
 * `pending` to `failed` update, deletes any bytes that did land, and keeps
 * the rows as `failed` tombstones so byte deletion can be retried on the
 * next run. A row that completes mid-sweep is skipped because its claim
 * matches zero rows, and a claimed row can no longer complete. Run it from
 * a recurring job.
 */
export async function cleanupStaleUploads({
  db,
  targets,
  olderThan = ONE_HOUR,
  retryWindow = ONE_DAY,
  batchSize = 500,
}: CleanupStaleUploadsOptions): Promise<CleanupStaleUploadsResult> {
  const now = Date.now()
  let claimed = 0
  let deleted = 0

  const deleteBytes = async (target: string, key: string) => {
    const provider = resolveTarget(targets, target)

    if (!(await provider.exists(key))) {
      return false
    }

    await provider.delete(key)
    return true
  }

  const stale = await db.upload.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(now - olderThan) } },
    omit: { data: true },
    take: batchSize,
  })

  for (const upload of stale) {
    const { count } = await db.upload.updateMany({
      where: { id: upload.id, status: 'pending' },
      data: { status: 'failed' },
    })

    if (count !== 1) {
      continue
    }

    claimed += 1

    if (
      upload.storageKey &&
      (await deleteBytes(upload.target, upload.storageKey))
    ) {
      deleted += 1
    }
  }

  const tombstones = await db.upload.findMany({
    where: {
      status: 'failed',
      storageKey: { not: null },
      createdAt: { gte: new Date(now - retryWindow) },
    },
    omit: { data: true },
    take: batchSize,
  })

  for (const upload of tombstones) {
    if (
      upload.storageKey &&
      (await deleteBytes(upload.target, upload.storageKey))
    ) {
      deleted += 1
    }
  }

  return { claimed, deleted }
}
