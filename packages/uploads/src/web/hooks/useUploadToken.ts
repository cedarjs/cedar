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
  /** Fetches a fresh token and resolves with it. */
  requestToken: () => Promise<string>
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
  const tokenRef = useRef<string | null>(null)

  const [execute, { loading, error }] = useLazyQuery<
    RequestUploadTokenData,
    RequestUploadTokenVariables
  >(REQUEST_UPLOAD_TOKEN, { fetchPolicy: 'no-cache' })

  const requestToken = useCallback(async () => {
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
  }, [execute, profile])

  return { requestToken, token, constraints, loading, error }
}
