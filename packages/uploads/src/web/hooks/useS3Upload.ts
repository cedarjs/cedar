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
   * succeeds, before the batch is reported complete. Defaults to `true`.
   * Turn it off when an S3 event webhook confirms uploads instead.
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
 * each upload before the batch counts as complete. The returned `uppy`
 * instance plugs into any Uppy UI.
 */
export function useS3Upload({
  profile,
  confirm = true,
  onUploadComplete,
  onUploadError,
}: UseS3UploadOptions): UseS3UploadResult {
  const { requestToken, getToken, constraints } = useUploadToken({ profile })

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
      const uploadToken = getToken() ?? (await requestToken())

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
    [createPresignedUploadUrl, getToken, requestToken],
  )

  // The Uppy instance is created once and reads the latest callback through
  // this ref, updated in an effect
  const getUploadParametersRef = useRef(getUploadParameters)

  useEffect(() => {
    getUploadParametersRef.current = getUploadParameters
  }, [getUploadParameters])

  const upload = useUppyUpload(
    () =>
      createUppy({
        provider: 's3',
        constraints,
        getUploadParameters: (file) => getUploadParametersRef.current(file),
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
      if (!getToken()) {
        requestToken().catch((e: unknown) => {
          onUploadError?.(e instanceof Error ? e : new Error(String(e)))
        })
      }
    }

    // A postprocessor runs after every file's PUT and before Uppy emits
    // `complete`, so an upload whose confirmation fails is reported as an
    // error instead of as a completed upload
    const confirmAll = async (fileIDs: string[]) => {
      if (!confirm) {
        return
      }

      for (const fileID of fileIDs) {
        const file = uppy.getFile(fileID)
        const uploadId = file?.meta.cedarUploadId

        if (!file || typeof uploadId !== 'string') {
          continue
        }

        try {
          const result = await confirmUpload({ variables: { uploadId } })

          if (result.data?.confirmUpload.status !== 'completed') {
            throw new Error(`Upload ${uploadId} could not be confirmed.`)
          }
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e))
          // Drop the id so `complete` does not report an unconfirmed upload
          uppy.setFileMeta(fileID, { cedarUploadId: undefined })
          uppy.setFileState(fileID, {
            error: error.message,
            response: undefined,
          })
          uppy.emit('upload-error', file, error)
        }
      }
    }

    uppy.on('file-added', onFileAdded)
    uppy.addPostProcessor(confirmAll)

    return () => {
      uppy.off('file-added', onFileAdded)
      uppy.removePostProcessor(confirmAll)
    }
  }, [uppy, confirm, confirmUpload, getToken, requestToken, onUploadError])

  return { ...upload, requestToken }
}
