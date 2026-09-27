import { useCallback, useEffect, useRef, useState } from 'react'

import type { ErrorLike } from '@apollo/client'
import { useLazyQuery } from '@apollo/client/react'

import { REQUEST_UPLOAD_TOKEN } from '../graphql.js'
import type {
  RequestUploadTokenData,
  RequestUploadTokenVariables,
  UploadConstraints,
} from '../graphql.js'

export interface UseUploadTokenOptions {
  /** Name of a server-defined upload profile. */
  profile: string
}

export interface UseUploadTokenResult {
  /**
   * Fetches a fresh token and resolves with it. Concurrent calls share one
   * in-flight request.
   */
  requestToken: () => Promise<string>
  /**
   * Resolves with a token that can still create `fileCount` files (default
   * 1) and counts them against it. Reuses the current token while it has
   * files left and is not about to expire, and fetches a fresh one
   * otherwise. Call it once per file (or once per batch, with the batch
   * size) right before the token is sent.
   */
  acquireToken: (fileCount?: number) => Promise<string>
  /**
   * Whether the current token is unexpired and has at least one file left,
   * so the next `acquireToken()` call can resolve without a request.
   */
  hasUsableToken: () => boolean
  /**
   * Returns the most recently fetched token, or `null`, without triggering
   * a render. Meant for event handlers and Uppy callbacks.
   */
  getToken: () => string | null
  /** The most recently fetched token, or `null`. */
  token: string | null
  /**
   * The profile's constraints, echoed by the server alongside the token for
   * client-side UX. `null` until the first successful fetch.
   */
  constraints: UploadConstraints | null
  loading: boolean
  error: ErrorLike | undefined
}

interface TokenState {
  token: string
  maxFiles: number
  /** Files this token has been handed out for through `acquireToken()`. */
  used: number
  /**
   * Client-clock time after which the token is treated as expired, or
   * `null` when the token's lifetime cannot be read.
   */
  expiresAt: number | null
}

/**
 * Upper bound on how long before its real expiry a token stops being
 * handed out, so a request started just before the deadline still carries
 * a valid token.
 */
const EXPIRY_MARGIN_MS = 30_000

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  )

  return atob(padded)
}

/**
 * Reads the lifetime (`exp - iat`, in milliseconds) from a signed token's
 * claims without verifying it. The lifetime is anchored to the client's
 * clock when the token arrives, so clock skew between browser and server
 * does not matter. Returns `null` for a token whose claims cannot be read.
 */
export function readTokenLifetimeMs(token: string): number | null {
  const [, claims] = token.split('.')

  if (!claims) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(claims))

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'exp' in parsed &&
      'iat' in parsed &&
      typeof parsed.exp === 'number' &&
      typeof parsed.iat === 'number' &&
      parsed.exp > parsed.iat
    ) {
      return (parsed.exp - parsed.iat) * 1000
    }
  } catch {
    // Not a readable token; fall through
  }

  return null
}

function expiresAtFor(token: string, receivedAt: number): number | null {
  const lifetime = readTokenLifetimeMs(token)

  if (lifetime === null) {
    return null
  }

  return receivedAt + lifetime - Math.min(EXPIRY_MARGIN_MS, lifetime / 2)
}

function canCreate(state: TokenState | null, fileCount: number) {
  if (!state) {
    return false
  }

  if (state.expiresAt !== null && Date.now() >= state.expiresAt) {
    return false
  }

  // A fresh token is always handed out, even for a batch bigger than its
  // `maxFiles`, so the server reports the real limit instead of the client
  // fetching tokens in a loop
  return state.used === 0 || state.used + fileCount <= state.maxFiles
}

/**
 * Fetches upload tokens for a profile from the `requestUploadToken` query.
 * Tokens expire, so the query runs with `fetchPolicy: 'no-cache'` and only
 * when a token is needed, never on mount.
 *
 * A token expires and can only create `maxFiles` files, so the hook tracks
 * both for the current token. `acquireToken()` hands the token out only
 * while it has files left and is not about to expire, and fetches a fresh
 * one otherwise, which lets one mounted component upload any number of
 * times.
 */
export function useUploadToken({
  profile,
}: UseUploadTokenOptions): UseUploadTokenResult {
  const [token, setToken] = useState<string | null>(null)
  const [constraints, setConstraints] = useState<UploadConstraints | null>(null)
  // Written only from event handlers (never during render), so it is safe
  // to read from Uppy callbacks without waiting for a re-render
  const tokenRef = useRef<TokenState | null>(null)
  const inFlight = useRef<Promise<string> | null>(null)
  const profileRef = useRef(profile)

  // Everything above is scoped to one profile. Clear it when the profile
  // changes so the next upload cannot reuse the previous profile's token or
  // limits; a request still in flight for the old profile is ignored.
  useEffect(() => {
    profileRef.current = profile
    tokenRef.current = null
    inFlight.current = null
    setToken(null)
    setConstraints(null)
  }, [profile])

  const [execute, { loading, error }] = useLazyQuery<
    RequestUploadTokenData,
    RequestUploadTokenVariables
  >(REQUEST_UPLOAD_TOKEN, { fetchPolicy: 'no-cache' })

  const requestToken = useCallback(() => {
    if (inFlight.current) {
      return inFlight.current
    }

    const requestedProfile = profile

    const request = (async () => {
      const result = await execute({ variables: { profile: requestedProfile } })

      if (requestedProfile !== profileRef.current) {
        throw new Error(
          'The upload profile changed while a token was requested.',
        )
      }

      if (result.error) {
        throw result.error instanceof Error
          ? result.error
          : new Error(result.error.message)
      }

      const data = result.data?.requestUploadToken

      if (!data) {
        throw new Error('The upload token query returned no data.')
      }

      tokenRef.current = {
        token: data.token,
        maxFiles: data.maxFiles,
        used: 0,
        expiresAt: expiresAtFor(data.token, Date.now()),
      }
      setToken(data.token)
      setConstraints({
        allowedMimeTypes: data.allowedMimeTypes,
        maxFileSize: Number(data.maxFileSize),
        maxFiles: data.maxFiles,
      })

      return data.token
    })().finally(() => {
      if (inFlight.current === request) {
        inFlight.current = null
      }
    })

    inFlight.current = request

    return request
  }, [execute, profile])

  const acquireToken = useCallback(
    async (fileCount = 1) => {
      // Waiters that share one fresh token can use it up between them, so
      // check again after every fetch. A fresh token is always usable, so
      // each pass either returns or makes progress.
      for (;;) {
        const current = tokenRef.current

        if (current && canCreate(current, fileCount)) {
          current.used += fileCount

          return current.token
        }

        await requestToken()
      }
    },
    [requestToken],
  )

  const hasUsableToken = useCallback(() => canCreate(tokenRef.current, 1), [])

  const getToken = useCallback(() => tokenRef.current?.token ?? null, [])

  return {
    requestToken,
    acquireToken,
    hasUsableToken,
    getToken,
    token,
    constraints,
    loading,
    error,
  }
}
