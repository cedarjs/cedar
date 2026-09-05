import { useCallback, useEffect, useRef } from 'react'

import { useMutation } from '@apollo/client/react'

import { createUppy, UPLOAD_TOKEN_HEADER } from '../createUppy.js'
import type { CedarUppyFile, PresignedUploadParameters } from '../createUppy.js'
import { CONFIRM_UPLOAD, CREATE_PRESIGNED_UPLOAD_URL } from '../graphql.js'
import type {
  ConfirmUploadData,
  ConfirmUploadVariables,
  CreatePresignedUploadUrlData,
  CreatePresignedUploadUrlVariables,
} from '../graphql.js'

import { useUploadToken } from './useUploadToken.js'
import { useUppyUpload } from './useUppyUpload.js'
import type { UppyUploadCallbacks, UppyUploadResult } from './useUppyUpload.js'

export interface UseS3UploadOptions extends UppyUploadCallbacks {
  /** Name of a server-defined upload profile. */
  profile: string
  /**
   * Confirm each upload through the `confirmUpload` mutation once the PUT
   * succeeds. Defaults to `true`. Turn it off when an S3 event webhook
   * confirms uploads instead.
   */
  confirm?: boolean
}

export type UseS3UploadResult = UppyUploadResult & {
  /** Fetches a fresh upload token. Called automatically before uploads. */
  requestToken: () => Promise<string>
}

/**
 * Direct-to-S3 uploads: fetches an upload token, asks the api for a
 * presigned URL per file, PUTs the bytes with `@uppy/aws-s3`, and confirms
 * each upload. The returned `uppy` instance plugs into any Uppy UI.
 */
export function useS3Upload({
  profile,
  confirm = true,
  onUploadComplete,
  onUploadError,
}: UseS3UploadOptions): UseS3UploadResult {
  const { requestToken, token, constraints } = useUploadToken({ profile })
  const tokenRef = useRef<string | null>(null)
  tokenRef.current = token

  const [createPresignedUploadUrl] = useMutation<
    CreatePresignedUploadUrlData,
    CreatePresignedUploadUrlVariables
  >(CREATE_PRESIGNED_UPLOAD_URL)

  const [confirmUpload] = useMutation<
    ConfirmUploadData,
    ConfirmUploadVariables
  >(CONFIRM_UPLOAD)

  const getUploadParameters = useCallback(
    async (file: CedarUppyFile): Promise<PresignedUploadParameters> => {
      const uploadToken = tokenRef.current ?? (await requestToken())

      const result = await createPresignedUploadUrl({
        variables: {
          input: {
            filename: file.name ?? 'file',
            contentType: file.type || 'application/octet-stream',
            size: String(file.size ?? 0),
          },
        },
        context: { headers: { [UPLOAD_TOKEN_HEADER]: uploadToken } },
      })

      const data = result.data?.createPresignedUploadUrl

      if (!data) {
        throw new Error('The presigned URL mutation returned no data.')
      }

      return data
    },
    [createPresignedUploadUrl, requestToken],
  )

  const upload = useUppyUpload(
    () =>
      createUppy({
        provider: 's3',
        constraints,
        getUploadParameters,
      }),
    constraints,
    { onUploadComplete, onUploadError },
  )

  const { uppy } = upload

  useEffect(() => {
    if (!uppy) {
      return
    }

    // Fetch a token as soon as files are added so restrictions apply before
    // the upload starts
    const onFileAdded = () => {
      if (!tokenRef.current) {
        requestToken().catch((e: unknown) => {
          onUploadError?.(e instanceof Error ? e : new Error(String(e)))
        })
      }
    }

    const onUploadSuccess = (file: CedarUppyFile | undefined) => {
      if (!confirm || !file) {
        return
      }

      const uploadId = uppy.getFile(file.id)?.meta.cedarUploadId

      if (typeof uploadId === 'string') {
        confirmUpload({ variables: { uploadId } }).catch((e: unknown) => {
          onUploadError?.(e instanceof Error ? e : new Error(String(e)))
        })
      }
    }

    uppy.on('file-added', onFileAdded)
    uppy.on('upload-success', onUploadSuccess)

    return () => {
      uppy.off('file-added', onFileAdded)
      uppy.off('upload-success', onUploadSuccess)
    }
  }, [uppy, confirm, confirmUpload, requestToken, onUploadError])

  return { ...upload, requestToken }
}
