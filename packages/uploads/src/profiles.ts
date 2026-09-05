import type { SignedTokenExpiresIn } from '@cedarjs/api'

import { UploadError } from './errors.js'

/**
 * Default size cap for files stored inline in the database. The DB path
 * buffers base64 through GraphQL, so it is only for small files.
 */
export const DB_MAX_FILE_SIZE = 1024 * 1024

/** Default lifetime of an upload token. */
export const DEFAULT_UPLOAD_TOKEN_EXPIRES_IN: SignedTokenExpiresIn = '5m'

/**
 * Server-defined constraints for one kind of upload. The client names a
 * profile; the server owns what that profile allows.
 */
export interface UploadProfile {
  /** Name of the storage target files uploaded under this profile land on. */
  target: string
  /**
   * MIME types the profile accepts. Exact types (`image/png`) and wildcard
   * subtypes (`image/*`) are supported.
   */
  allowedMimeTypes: string[]
  /** Largest file the profile accepts, in bytes. */
  maxFileSize: number
  /** Most files one token may create, across every request that uses it. */
  maxFiles: number
  /** Lifetime of tokens issued for this profile. Defaults to five minutes. */
  expiresIn?: SignedTokenExpiresIn
}

export type UploadProfiles = Record<string, UploadProfile>

export interface ResolvedUploadProfile extends UploadProfile {
  name: string
}

function validateProfile(name: string, profile: UploadProfile) {
  if (!profile.target) {
    throw new UploadError(
      'CONFIGURATION',
      `Upload profile '${name}' needs a \`target\`.`,
    )
  }

  if (!profile.allowedMimeTypes?.length) {
    throw new UploadError(
      'CONFIGURATION',
      `Upload profile '${name}' needs at least one entry in ` +
        '`allowedMimeTypes`.',
    )
  }

  if (!(profile.maxFileSize > 0)) {
    throw new UploadError(
      'CONFIGURATION',
      `Upload profile '${name}' needs a positive \`maxFileSize\`.`,
    )
  }

  if (!Number.isInteger(profile.maxFiles) || profile.maxFiles < 1) {
    throw new UploadError(
      'CONFIGURATION',
      `Upload profile '${name}' needs \`maxFiles\` of at least 1.`,
    )
  }
}

/**
 * Validates and returns the app's upload profiles. Returns the same object,
 * typed, so `profiles.avatar` works for direct access.
 */
export function defineUploadProfiles<T extends UploadProfiles>(profiles: T): T {
  for (const [name, profile] of Object.entries(profiles)) {
    validateProfile(name, profile)
  }

  return profiles
}

/**
 * Looks a profile up by name, throwing an `UploadError` with code
 * `UNKNOWN_PROFILE` when it is missing. Unknown names are a client error, so
 * the message does not list the configured profiles.
 */
export function resolveProfile(
  profiles: UploadProfiles,
  name: string,
): ResolvedUploadProfile {
  // Own-property check so inherited names such as `constructor` cannot
  // resolve to a non-profile value
  const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined

  if (!profile) {
    throw new UploadError(
      'UNKNOWN_PROFILE',
      `Unknown upload profile '${name}'.`,
    )
  }

  return { ...profile, name }
}

/**
 * Whether `mimeType` matches one of `allowed`. Matching is case-insensitive
 * and ignores parameters such as `; charset=utf-8`. An entry of `image/*`
 * matches every `image/` subtype.
 */
export function isMimeTypeAllowed(allowed: string[], mimeType: string) {
  const normalized = mimeType.split(';')[0].trim().toLowerCase()

  if (!normalized) {
    return false
  }

  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase()

    if (pattern === '*/*') {
      return true
    }

    if (pattern.endsWith('/*')) {
      return normalized.startsWith(pattern.slice(0, -1))
    }

    return pattern === normalized
  })
}
