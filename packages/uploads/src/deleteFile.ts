import type { StorageProvider, UploadDatabase, UploadRecord } from './types.js'

export interface DeleteFileOptions {
  db: UploadDatabase
  upload: Pick<UploadRecord, 'id' | 'storageKey'>
}

function isRecordNotFound(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2025'
  )
}

/**
 * Deletes a stored file: bytes first, then the `Upload` row. Bytes-first
 * ordering means a crash between the two steps leaves a row whose object is
 * gone, which the app can see and fix by calling again, whereas the reverse
 * order would leave an unreachable object nothing references. A missing
 * object or row is tolerated, so the call is idempotent.
 */
export async function deleteFile(
  target: StorageProvider,
  { db, upload }: DeleteFileOptions,
): Promise<void> {
  if (upload.storageKey) {
    await target.delete(upload.storageKey)
  }

  try {
    await db.upload.delete({ where: { id: upload.id } })
  } catch (e) {
    if (!isRecordNotFound(e)) {
      throw e
    }
  }
}
