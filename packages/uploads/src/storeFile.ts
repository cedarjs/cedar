import { UploadError } from './errors.js'
import { generateStorageKey } from './keys.js'
import { DB_MAX_FILE_SIZE } from './profiles.js'
import type { StorageProvider, UploadDatabase, UploadRecord } from './types.js'

export interface StoreFileOptions {
  db: UploadDatabase
  filename: string
  mimeType: string
  data: Uint8Array
  /**
   * Reject `data` larger than this many bytes. Defaults to the 1 MB DB cap
   * for `providerType: 'db'` targets and to unlimited for object storage.
   */
  maxSize?: number
  /**
   * Owner of the file, when it belongs to a user. Persisted so the ownership
   * checks that guard user uploads apply to server-stored files too.
   */
  userId?: string
  /** Owning organization, for multi-tenant apps. */
  organizationId?: string
}

/**
 * Stores a file directly on a target and creates its `Upload` row. This is
 * the path for server-generated files (PDFs, exports, thumbnails) and for
 * files that arrive as base64 through GraphQL. It bypasses tokens, the
 * upload routes, and Uppy entirely.
 */
export async function storeFile(
  target: StorageProvider,
  options: StoreFileOptions,
): Promise<UploadRecord> {
  const { db, filename, mimeType, data, maxSize, userId, organizationId } =
    options

  const isDbProvider = target.providerType === 'db'
  const cap = maxSize ?? (isDbProvider ? DB_MAX_FILE_SIZE : undefined)

  if (cap !== undefined && data.byteLength > cap) {
    throw new UploadError(
      'FILE_TOO_LARGE',
      `File is ${data.byteLength} bytes, which exceeds the ${cap} byte limit ` +
        `for target '${target.name}'.`,
    )
  }

  const key = isDbProvider ? null : generateStorageKey(mimeType)

  if (key) {
    await target.write(key, data, { contentType: mimeType })
  }

  try {
    return await createRow()
  } catch (e) {
    // Nothing references the object yet, so delete it rather than leave it
    // orphaned; the cleanup job only finds keys through rows
    if (key) {
      await target.delete(key).catch(() => undefined)
    }

    throw e
  }

  function createRow() {
    return db.upload.create({
      data: {
        target: target.name,
        status: 'completed',
        filename,
        mimeType,
        size: BigInt(data.byteLength),
        storageKey: key,
        // Copying gives Prisma the plain-ArrayBuffer-backed array its `Bytes`
        // input requires, whatever `data` was backed by
        data: isDbProvider ? new Uint8Array(data) : null,
        userId: userId ?? null,
        organizationId: organizationId ?? null,
      },
    })
  }
}
