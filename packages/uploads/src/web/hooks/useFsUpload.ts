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
  const { requestToken, getToken, constraints } = useUploadToken({ profile })
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
        getUploadToken: getToken,
      }),
    constraints,
    { onUploadComplete, onUploadError },
  )

  const { uppy } = upload

  useEffect(() => {
    if (!uppy) {
      return
    }

    // The XHR plugin reads headers when the request starts, so the token
    // has to exist before `upload()` runs. Fetch it on the first file and
    // hold the upload until it is there. `requestToken` shares one in-flight
    // request, so these two callers never race.
    const onFileAdded = () => {
      if (!getToken()) {
        requestToken().catch((e: unknown) => {
          onUploadError?.(e instanceof Error ? e : new Error(String(e)))
        })
      }
    }

    const ensureToken = async () => {
      if (!getToken()) {
        await requestToken()
      }
    }

    uppy.on('file-added', onFileAdded)
    uppy.addPreProcessor(ensureToken)

    return () => {
      uppy.off('file-added', onFileAdded)
      uppy.removePreProcessor(ensureToken)
    }
  }, [uppy, getToken, requestToken, onUploadError])

  return { ...upload, requestToken }
}
