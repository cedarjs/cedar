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
import type { StorageTargets, UploadDatabase, UploadRecord } from './types.js'
import { createUploadToken } from './uploadToken.js'
import type { UploadTokenPayload } from './uploadToken.js'

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
}: CreatePresignedUploadOptions): Promise<PresignedUploadResponse> {
  const size = toBigInt(input.size, 'file size')

  assertTokenAllowsFile(tokenPayload, { contentType: input.contentType, size })

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

  const presigned = await target.getPresignedUploadUrl(storageKey, {
    contentType: input.contentType,
    size,
  })

  return { uploadId: upload.id, ...presigned }
}

export interface ConfirmUploadOptions {
  db: UploadDatabase
  targets: StorageTargets
  uploadId: string
  currentUser: UploadActor | null | undefined
}

/**
 * Client-side confirmation of a direct upload. Verifies that the object
 * exists in storage and that its size matches what the token authorized,
 * then flips the row `pending` to `completed`. On a size mismatch the row is
 * claimed `failed` and the object deleted. Only the user (and organization)
 * the upload was issued to can confirm it.
 */
export async function confirmUpload({
  db,
  targets,
  uploadId,
  currentUser,
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

  if (actualSize === null || BigInt(actualSize) !== upload.size) {
    // Claim the row before touching bytes; if a concurrent path settled it
    // first, leave the settled state alone
    const { count } = await db.upload.updateMany({
      where: { id: uploadId, status: 'pending' },
      data: { status: 'failed' },
    })

    if (count === 1) {
      await target.delete(upload.storageKey)
    }

    throw new UploadError(
      'SIZE_MISMATCH',
      `Uploaded object is ${actualSize ?? 'of unknown'} bytes but ` +
        `${upload.size} bytes were authorized.`,
    )
  }

  // Conditional transition: a row the cleanup job already claimed stays
  // failed instead of being resurrected
  await db.upload.updateMany({
    where: { id: uploadId, status: 'pending' },
    data: { status: 'completed' },
  })

  const confirmed = await db.upload.findFirst({
    where: { id: uploadId },
    omit: { data: true },
  })

  if (!confirmed) {
    throw new UploadError('NOT_FOUND', 'Upload not found.')
  }

  return confirmed
}
