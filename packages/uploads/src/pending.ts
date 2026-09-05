import { UploadError } from './errors.js'
import { isMimeTypeAllowed } from './profiles.js'
import type { UploadDatabase, UploadRecord } from './types.js'
import type { UploadTokenPayload } from './uploadToken.js'

/**
 * Checks one file against the constraints signed into an upload token.
 * Throws `MIME_TYPE_NOT_ALLOWED` or `FILE_TOO_LARGE`.
 */
export function assertTokenAllowsFile(
  payload: UploadTokenPayload,
  file: { contentType: string; size: bigint },
) {
  if (!isMimeTypeAllowed(payload.allowedMimeTypes, file.contentType)) {
    throw new UploadError(
      'MIME_TYPE_NOT_ALLOWED',
      `File type '${file.contentType}' is not allowed for upload profile ` +
        `'${payload.profile}'.`,
    )
  }

  if (file.size < 0n) {
    throw new UploadError('FILE_TOO_LARGE', 'File size must not be negative.')
  }

  if (file.size > BigInt(payload.maxFileSize)) {
    throw new UploadError(
      'FILE_TOO_LARGE',
      `File is ${file.size} bytes, which exceeds the ${payload.maxFileSize} ` +
        `byte limit for upload profile '${payload.profile}'.`,
    )
  }
}

export interface CreatePendingUploadOptions {
  db: UploadDatabase
  payload: UploadTokenPayload
  filename: string
  mimeType: string
  size: bigint
  storageKey: string
}

/**
 * Creates a `pending` row for a token, enforcing the token's `maxFiles`
 * across every request that uses it. The count and the insert run in one
 * serializable transaction keyed on `tokenId`, so concurrent requests sharing
 * a token cannot exceed the limit.
 */
export async function createPendingUpload({
  db,
  payload,
  filename,
  mimeType,
  size,
  storageKey,
}: CreatePendingUploadOptions): Promise<UploadRecord> {
  return db.$transaction(
    async (tx) => {
      const existing = await tx.upload.count({
        where: { tokenId: payload.jti },
      })

      if (existing >= payload.maxFiles) {
        throw new UploadError(
          'TOO_MANY_FILES',
          `This upload token has already been used for ${existing} of its ` +
            `${payload.maxFiles} allowed files.`,
        )
      }

      return tx.upload.create({
        data: {
          target: payload.target,
          status: 'pending',
          filename,
          mimeType,
          size,
          storageKey,
          userId: payload.sub,
          tokenId: payload.jti,
          organizationId: payload.organizationId ?? null,
        },
      })
    },
    { isolationLevel: 'Serializable' },
  )
}

/**
 * Enforces that the user (and, in multi-tenant apps, the organization) a
 * token or row belongs to is the one acting on it. `null` identity on the
 * row means "unowned" and passes.
 */
export function assertOwnership(
  owner: { userId: string | null; organizationId: string | null },
  actor:
    { id: string | number; organizationId?: string | null } | null | undefined,
  what: string,
) {
  if (!actor) {
    throw new UploadError(
      'UNAUTHENTICATED',
      `You must be logged in to ${what}.`,
    )
  }

  if (owner.userId && owner.userId !== String(actor.id)) {
    throw new UploadError('FORBIDDEN', `You don't have access to ${what}.`)
  }

  if (
    owner.organizationId &&
    owner.organizationId !== (actor.organizationId ?? null)
  ) {
    throw new UploadError('FORBIDDEN', `You don't have access to ${what}.`)
  }
}
