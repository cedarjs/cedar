import { useEffect, useRef } from 'react'

import { createUppy, DEFAULT_FS_UPLOAD_PATH } from '../createUppy.js'

import { useUploadToken } from './useUploadToken.js'
import { useUppyUpload } from './useUppyUpload.js'
import type { UppyUploadCallbacks, UppyUploadResult } from './useUppyUpload.js'

export interface UseFsUploadOptions extends UppyUploadCallbacks {
  /** Name of a server-defined upload profile. */
  profile: string
  /**
   * Full URL of the api's upload route. Defaults to the api URL from
   * `RWJS_API_URL` plus `/upload/fs`. Read on every request, so it may
   * change after mount.
   */
  endpoint?: string
}

export type UseFsUploadResult = UppyUploadResult & {
  requestToken: () => Promise<string>
}

declare const RWJS_API_URL: string | undefined

function defaultEndpoint(): string {
  const apiUrl =
    typeof RWJS_API_URL === 'string' ? RWJS_API_URL.replace(/\/+$/, '') : ''

  return `${apiUrl}${DEFAULT_FS_UPLOAD_PATH}`
}

/**
 * Uploads through the api server to an FS target: fetches an upload token
 * and posts each file to `POST {prefix}/fs` with `@uppy/xhr-upload`.
 */
export function useFsUpload({
  profile,
  endpoint,
  onUploadComplete,
  onUploadError,
}: UseFsUploadOptions): UseFsUploadResult {
  const { requestToken, acquireToken, hasUsableToken, constraints } =
    useUploadToken({ profile })
  // The token each file is sent with, assigned when its upload starts. A
  // later batch may move on to a fresh token while this one is still
  // uploading, so the token is recorded per file.
  const fileTokens = useRef(new Map<string, string>())
  // The Uppy instance is created once; the endpoint is read per request
  // through this ref, updated in an effect
  const endpointRef = useRef(endpoint ?? defaultEndpoint())

  useEffect(() => {
    endpointRef.current = endpoint ?? defaultEndpoint()
  }, [endpoint])

  const upload = useUppyUpload(
    () =>
      createUppy({
        provider: 'fs',
        constraints,
        endpoint: () => endpointRef.current,
        getUploadToken: (file) => fileTokens.current.get(file.id) ?? null,
      }),
    constraints,
    { onUploadComplete, onUploadError },
  )

  const { uppy } = upload

  useEffect(() => {
    if (!uppy) {
      return
    }

    // The XHR plugin reads headers when the request starts, so every file
    // needs its token before `upload()` runs. Fetch one early when a file is
    // added, so the profile's restrictions apply sooner, and assign tokens
    // to the batch in a preprocessor. `requestToken` shares one in-flight
    // request, so these callers never race.
    const onFileAdded = () => {
      if (!hasUsableToken()) {
        requestToken().catch((e: unknown) => {
          onUploadError?.(e instanceof Error ? e : new Error(String(e)))
        })
      }
    }

    const assignTokens = async (fileIDs: string[]) => {
      if (fileIDs.length === 0) {
        return
      }

      const token = await acquireToken(fileIDs.length)

      for (const fileID of fileIDs) {
        fileTokens.current.set(fileID, token)
      }
    }

    const onFileRemoved = (file: { id: string } | undefined) => {
      if (file) {
        fileTokens.current.delete(file.id)
      }
    }

    uppy.on('file-added', onFileAdded)
    uppy.on('file-removed', onFileRemoved)
    uppy.addPreProcessor(assignTokens)

    return () => {
      uppy.off('file-added', onFileAdded)
      uppy.off('file-removed', onFileRemoved)
      uppy.removePreProcessor(assignTokens)
    }
  }, [uppy, acquireToken, hasUsableToken, requestToken, onUploadError])

  return { ...upload, requestToken }
}
