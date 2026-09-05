import { useCallback, useRef, useState } from 'react'

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

/**
 * Fetches upload tokens for a profile from the `requestUploadToken` query.
 * Tokens expire, so the query runs with `fetchPolicy: 'no-cache'` and only
 * when `requestToken()` is called, never on mount.
 */
export function useUploadToken({
  profile,
}: UseUploadTokenOptions): UseUploadTokenResult {
  const [token, setToken] = useState<string | null>(null)
  const [constraints, setConstraints] = useState<UploadConstraints | null>(null)
  // Written only from event handlers (never during render), so it is safe
  // to read from Uppy callbacks without waiting for a re-render
  const tokenRef = useRef<string | null>(null)
  const inFlight = useRef<Promise<string> | null>(null)

  const [execute, { loading, error }] = useLazyQuery<
    RequestUploadTokenData,
    RequestUploadTokenVariables
  >(REQUEST_UPLOAD_TOKEN, { fetchPolicy: 'no-cache' })

  const requestToken = useCallback(() => {
    if (inFlight.current) {
      return inFlight.current
    }

    const request = (async () => {
      const result = await execute({ variables: { profile } })

      if (result.error) {
        throw result.error instanceof Error
          ? result.error
          : new Error(result.error.message)
      }

      const data = result.data?.requestUploadToken

      if (!data) {
        throw new Error('The upload token query returned no data.')
      }

      tokenRef.current = data.token
      setToken(data.token)
      setConstraints({
        allowedMimeTypes: data.allowedMimeTypes,
        maxFileSize: Number(data.maxFileSize),
        maxFiles: data.maxFiles,
      })

      return data.token
    })().finally(() => {
      inFlight.current = null
    })

    inFlight.current = request

    return request
  }, [execute, profile])

  const getToken = useCallback(() => tokenRef.current, [])

  return { requestToken, getToken, token, constraints, loading, error }
}
