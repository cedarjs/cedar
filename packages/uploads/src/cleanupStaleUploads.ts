import { resolveTarget } from './targets.js'
import type { StorageTargets, UploadDatabase, UploadRecord } from './types.js'

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
  /**
   * Called for each row whose storage operation failed. Defaults to
   * `console.error`. The sweep continues with the next row either way.
   */
  onError?: (error: unknown, upload: UploadRecord) => void
}

export interface CleanupStaleUploadsResult {
  /** Rows moved from `pending` to `failed` by this run. */
  claimed: number
  /** Objects deleted from storage by this run. */
  deleted: number
  /** Rows whose storage operation failed and will be retried next run. */
  errors: number
}

/**
 * Sweeps stale uploads. Presigned uploads that were issued but never
 * completed, and route uploads that crashed between row creation and write,
 * leave `pending` rows behind. This claims them with a conditional
 * `pending` to `failed` update, deletes any bytes that did land, and keeps
 * the rows as `failed` tombstones so byte deletion can be retried on the
 * next run. A row that completes mid-sweep is skipped because its claim
 * matches zero rows, and a claimed row can no longer complete.
 *
 * Once a tombstone's bytes are confirmed gone its `storageKey` is cleared,
 * which drops it from the next run's re-check. A row whose target is
 * unknown or whose provider fails is reported through `onError` and left
 * for the next run; it never aborts the sweep. Run it from a recurring job.
 */
export async function cleanupStaleUploads({
  db,
  targets,
  olderThan = ONE_HOUR,
  retryWindow = ONE_DAY,
  batchSize = 500,
  onError = (error, upload) =>
    console.error(`[cedar uploads] cleanup failed for ${upload.id}:`, error),
}: CleanupStaleUploadsOptions): Promise<CleanupStaleUploadsResult> {
  const now = Date.now()
  let claimed = 0
  let deleted = 0
  let errors = 0
  // Rows claimed by this run are not re-checked by its tombstone pass
  const claimedIds = new Set<string>()

  // Deletes the row's bytes if they exist, then clears `storageKey` so the
  // row is not re-checked. Returns whether an object was deleted.
  const reclaim = async (upload: UploadRecord): Promise<boolean> => {
    if (!upload.storageKey) {
      return false
    }

    try {
      const provider = resolveTarget(targets, upload.target)
      const existed = await provider.exists(upload.storageKey)

      if (existed) {
        await provider.delete(upload.storageKey)
      }

      await db.upload.updateMany({
        where: { id: upload.id, status: 'failed' },
        data: { storageKey: null },
      })

      return existed
    } catch (e) {
      errors += 1
      onError(e, upload)
      return false
    }
  }

  const stale = await db.upload.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(now - olderThan) } },
    omit: { data: true },
    orderBy: { createdAt: 'asc' },
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
    claimedIds.add(upload.id)

    if (await reclaim(upload)) {
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
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  })

  for (const upload of tombstones) {
    if (claimedIds.has(upload.id)) {
      continue
    }

    if (await reclaim(upload)) {
      deleted += 1
    }
  }

  return { claimed, deleted, errors }
}
