export type UploadErrorCode =
  | 'CONFIGURATION'
  | 'UNKNOWN_TARGET'
  | 'UNKNOWN_PROFILE'
  | 'UNAUTHENTICATED'
  | 'INVALID_TOKEN'
  | 'TOKEN_USER_MISMATCH'
  | 'TOKEN_ORGANIZATION_MISMATCH'
  | 'MIME_TYPE_NOT_ALLOWED'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'PRESIGN_NOT_SUPPORTED'
  | 'NOT_SUPPORTED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_PENDING'
  | 'NOT_IN_STORAGE'
  | 'SIZE_MISMATCH'
  | 'INVALID_KEY'

const STATUS_CODES: Record<UploadErrorCode, number> = {
  CONFIGURATION: 500,
  UNKNOWN_TARGET: 500,
  UNKNOWN_PROFILE: 400,
  UNAUTHENTICATED: 401,
  INVALID_TOKEN: 401,
  TOKEN_USER_MISMATCH: 403,
  TOKEN_ORGANIZATION_MISMATCH: 403,
  MIME_TYPE_NOT_ALLOWED: 415,
  FILE_TOO_LARGE: 413,
  TOO_MANY_FILES: 400,
  PRESIGN_NOT_SUPPORTED: 400,
  NOT_SUPPORTED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_PENDING: 409,
  NOT_IN_STORAGE: 409,
  SIZE_MISMATCH: 409,
  INVALID_KEY: 400,
}

/**
 * Thrown by every part of the uploads package when a request cannot be
 * honored. `code` is stable for programmatic handling and `statusCode` is the
 * HTTP status the Fastify routes respond with.
 */
export class UploadError extends Error {
  code: UploadErrorCode
  statusCode: number

  constructor(code: UploadErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'UploadError'
    this.code = code
    this.statusCode = STATUS_CODES[code]
  }
}
