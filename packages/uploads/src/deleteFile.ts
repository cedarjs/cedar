import type { StorageProvider, UploadDatabase, UploadRecord } from './types.js'

export interface DeleteFileOptions {
  db: UploadDatabase
  upload: Pick<UploadRecord, 'id' | 'storageKey'>
  /**
   * The app's derived files (`defineDerivedFiles()` with an `uploadSource()`).
   * When given, the upload's derived files (thumbnails, previews) are deleted
   * first.
   */
  derivedFiles?: {
    deleteForUpload(upload: { id: string }): Promise<number>
  }
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
 *
 * Pass `derivedFiles` to delete the upload's derived files with it, both
 * before and after the upload itself, so a derived file being made from it
 * at the same moment is deleted too.
 */
export async function deleteFile(
  target: StorageProvider,
  { db, upload, derivedFiles }: DeleteFileOptions,
): Promise<void> {
  // Before, so a refusal leaves everything in place
  await derivedFiles?.deleteForUpload(upload)

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

  // And after: an attempt that read the upload before it was deleted has
  // its row by now, and finds its claim gone when it finishes
  await derivedFiles?.deleteForUpload(upload)
}
