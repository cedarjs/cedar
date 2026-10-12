import { isClaimedContentTypeAllowed } from './detectContentType.js'
import { UploadError } from './errors.js'
import { generateStorageKey } from './keys.js'
import {
  assertOwnership,
  assertTokenAllowsFile,
  createPendingUpload,
} from './pending.js'
import { resolveProfile } from './profiles.js'
import type { UploadProfiles } from './profiles.js'
import { resolveTarget } from './targets.js'
import type {
  PresignedUploadUrl,
  StorageProvider,
  StorageTargets,
  UploadDatabase,
  UploadRecord,
} from './types.js'
import { createUploadToken } from './uploadToken.js'
import type { UploadTokenPayload } from './uploadToken.js'
import { verifyStoredContentType } from './verifyStoredContentType.js'

/** The identity a token is issued to. */
export interface UploadActor {
  id: string | number
  organizationId?: string | null
}

export interface IssueUploadTokenOptions {
  profiles: UploadProfiles
  /** Name of the profile the client asked for. */
  profile: string
  secret: string
  /** The requesting user. Tokens are always bound to a user. */
  currentUser: UploadActor | null | undefined
  /** The organization to bind the token to, in multi-tenant apps. */
  organizationId?: string | null
}

export interface UploadTokenResponse {
  token: string
  allowedMimeTypes: string[]
  maxFileSize: bigint
  maxFiles: number
}

/**
 * Issues an upload token for a server-defined profile, bound to the
 * requesting user. This is what the generated `requestUploadToken` resolver
 * calls. The response echoes the profile's constraints for client-side UX;
 * the authoritative copy is inside the signed token.
 */
export function issueUploadToken({
  profiles,
  profile: profileName,
  secret,
  currentUser,
  organizationId,
}: IssueUploadTokenOptions): UploadTokenResponse {
  if (!currentUser) {
    throw new UploadError(
      'UNAUTHENTICATED',
      'You must be logged in to request an upload token.',
    )
  }

  const profile = resolveProfile(profiles, profileName)
  const org = organizationId ?? currentUser.organizationId ?? undefined

  const token = createUploadToken({
    payload: {
      profile: profile.name,
      allowedMimeTypes: profile.allowedMimeTypes,
      maxFileSize: profile.maxFileSize,
      maxFiles: profile.maxFiles,
      target: profile.target,
      sub: String(currentUser.id),
      ...(org ? { organizationId: org } : {}),
    },
    secret,
    expiresIn: profile.expiresIn,
  })

  return {
    token,
    allowedMimeTypes: profile.allowedMimeTypes,
    maxFileSize: BigInt(profile.maxFileSize),
    maxFiles: profile.maxFiles,
  }
}

export interface CreatePresignedUploadInput {
  filename: string
  contentType: string
  size: bigint | number | string
}

export interface CreatePresignedUploadOptions {
  db: UploadDatabase
  targets: StorageTargets
  /** The validated token, as attached to context by `@requireUploadToken`. */
  tokenPayload: UploadTokenPayload
  input: CreatePresignedUploadInput
  /**
   * Holds the declared type to the rules `acceptedContentType()` applies to
   * a type it can't check by bytes: no wildcard types, and types that can
   * carry script (`SCRIPTABLE_CONTENT_TYPES`) only when the profile lists
   * them exactly. Pair it with `verifyContentType` on `confirmUpload` (and
   * the S3 webhook), which checks the bytes against the declared type.
   * Defaults to `true`; `false` checks the declared type with
   * `isMimeTypeAllowed()` only.
   */
  verifyContentType?: boolean
}

export interface PresignedUploadResponse {
  uploadId: string
  url: string
  method: string
  headers: Record<string, string>
}

function toBigInt(value: bigint | number | string, what: string): bigint {
  try {
    return BigInt(value)
  } catch {
    throw new UploadError('FILE_TOO_LARGE', `Invalid ${what}: ${value}`)
  }
}

/**
 * Validates a file against the token, creates its `pending` row, and returns
 * a presigned URL the client PUTs the bytes to. This is what the generated
 * `createPresignedUploadUrl` resolver calls.
 */
export async function createPresignedUpload({
  db,
  targets,
  tokenPayload,
  input,
  verifyContentType = true,
}: CreatePresignedUploadOptions): Promise<PresignedUploadResponse> {
  const size = toBigInt(input.size, 'file size')

  assertTokenAllowsFile(tokenPayload, { contentType: input.contentType, size })

  if (
    verifyContentType &&
    !isClaimedContentTypeAllowed(
      tokenPayload.allowedMimeTypes,
      input.contentType,
    )
  ) {
    throw new UploadError(
      'MIME_TYPE_NOT_ALLOWED',
      `File type '${input.contentType}' is not allowed for upload profile ` +
        `'${tokenPayload.profile}'. Types that can carry script must be ` +
        'listed exactly, not through a wildcard.',
    )
  }

  const target = resolveTarget(targets, tokenPayload.target)
  const storageKey = generateStorageKey(input.contentType)

  // Row first: a crash between the row and the presign leaves a pending row
  // the cleanup job can find, whereas presign-first could leave an object
  // nothing references
  const upload = await createPendingUpload({
    db,
    payload: tokenPayload,
    filename: input.filename,
    mimeType: input.contentType,
    size,
    storageKey,
  })

  let presigned: PresignedUploadUrl

  try {
    presigned = await target.getPresignedUploadUrl(storageKey, {
      contentType: input.contentType,
      size,
    })
  } catch (e) {
    // The row was counted against the token; release the slot again
    await db.upload.delete({ where: { id: upload.id } }).catch(() => undefined)
    throw e
  }

  return { uploadId: upload.id, ...presigned }
}

export interface ConfirmUploadOptions {
  db: UploadDatabase
  targets: StorageTargets
  uploadId: string
  currentUser: UploadActor | null | undefined
  /**
   * Checks the object's bytes against the type the client declared for it
   * when it asked for the upload URL, with a ranged read of its head (and of
   * its tail for ZIPs), and records the canonical spelling of that type. A
   * mismatch fails the row and deletes the object. Defaults to `true`.
   */
  verifyContentType?: boolean
}

/**
 * Claims a pending row `failed` and deletes its object. Leaves a row some
 * other path settled first alone.
 */
async function failUpload(
  db: UploadDatabase,
  target: StorageProvider,
  upload: UploadRecord & { storageKey: string },
) {
  const { count } = await db.upload.updateMany({
    where: { id: upload.id, status: 'pending' },
    data: { status: 'failed' },
  })

  if (count === 1) {
    await target.delete(upload.storageKey)
  }
}

/**
 * Client-side confirmation of a direct upload. Verifies that the object
 * exists in storage, that its size matches what the token authorized, and
 * (with `verifyContentType`, the default) that its bytes are the type the
 * client declared, then flips the row `pending` to `completed`. On a
 * mismatch the row is claimed `failed` and the object deleted. Only the user
 * (and organization) the upload was issued to can confirm it.
 */
export async function confirmUpload({
  db,
  targets,
  uploadId,
  currentUser,
  verifyContentType = true,
}: ConfirmUploadOptions): Promise<UploadRecord> {
  const upload = await db.upload.findFirst({
    where: { id: uploadId },
    omit: { data: true },
  })

  if (!upload) {
    throw new UploadError('NOT_FOUND', 'Upload not found.')
  }

  assertOwnership(upload, currentUser, 'this upload')

  if (upload.status !== 'pending' || !upload.storageKey) {
    throw new UploadError('NOT_PENDING', 'Upload is not awaiting confirmation.')
  }

  const target = resolveTarget(targets, upload.target)

  if (!(await target.exists(upload.storageKey))) {
    throw new UploadError('NOT_IN_STORAGE', 'Upload not found in storage.')
  }

  const actualSize = await target.getObjectSize(upload.storageKey)

  const storedUpload = { ...upload, storageKey: upload.storageKey }

  if (actualSize === null || BigInt(actualSize) !== upload.size) {
    // Claim the row before touching bytes; if a concurrent path settled it
    // first, leave the settled state alone
    await failUpload(db, target, storedUpload)

    throw new UploadError(
      'SIZE_MISMATCH',
      `Uploaded object is ${actualSize ?? 'of unknown'} bytes but ` +
        `${upload.size} bytes were authorized.`,
    )
  }

  let mimeType = upload.mimeType

  if (verifyContentType) {
    const verified = await verifyStoredContentType(target, upload.storageKey, {
      size: actualSize,
      declaredType: upload.mimeType,
    })

    if (!verified) {
      await failUpload(db, target, storedUpload)

      throw new UploadError(
        'MIME_TYPE_NOT_ALLOWED',
        `Uploaded file is not of the type '${upload.mimeType}' it was ` +
          'declared as, so it was deleted.',
      )
    }

    // The object keeps the Content-Type it was uploaded with, which is the
    // declared type: the presigned URL signs it. That differs from
    // `verified` at most in spelling (`image/jpg` for `image/jpeg`), since
    // the bytes had to be the declared type, so the object's metadata needs
    // no rewrite, and S3 never serves it as a type its bytes aren't.
    mimeType = verified
  }

  // Conditional transition: a row the cleanup job already claimed stays
  // failed instead of being resurrected
  const { count } = await db.upload.updateMany({
    where: { id: uploadId, status: 'pending' },
    data: {
      status: 'completed',
      ...(mimeType !== upload.mimeType ? { mimeType } : {}),
    },
  })

  const confirmed = await db.upload.findFirst({
    where: { id: uploadId },
    omit: { data: true },
  })

  if (!confirmed) {
    throw new UploadError('NOT_FOUND', 'Upload not found.')
  }

  // A concurrent path settled the row first; only a completed row counts
  if (count === 0 && confirmed.status !== 'completed') {
    throw new UploadError(
      'NOT_PENDING',
      'Upload was marked failed before it could be confirmed.',
    )
  }

  return confirmed
}
