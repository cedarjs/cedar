import type { SerializedUpload, UploadRecord } from './types.js'

/** Builds a `data:` URI from a MIME type and raw bytes. */
export function toDataUri(mimeType: string, data: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
}

/**
 * Converts an `Upload` row into plain JSON: `size` becomes a string (it is a
 * `BigInt`), dates become ISO strings, and the inline `data` and `tokenId`
 * columns are left out.
 */
export function serializeUpload(upload: UploadRecord): SerializedUpload {
  return {
    id: upload.id,
    target: upload.target,
    status: upload.status,
    filename: upload.filename,
    mimeType: upload.mimeType,
    size: upload.size.toString(),
    storageKey: upload.storageKey,
    userId: upload.userId,
    organizationId: upload.organizationId,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString(),
  }
}
