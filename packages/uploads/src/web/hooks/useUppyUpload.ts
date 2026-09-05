import { useEffect, useRef, useState } from 'react'

import { getCedarUploadId } from '../createUppy.js'
import type { CedarUppy, CedarUppyFile } from '../createUppy.js'
import type { UploadConstraints } from '../graphql.js'

export interface UppyUploadCallbacks {
  /** Called with the `Upload` ids of every file once a batch finishes. */
  onUploadComplete?: (uploadIds: string[]) => void
  onUploadError?: (error: Error) => void
}

export interface UppyUploadResult {
  /** The Uppy instance, or `null` while it is being created. */
  uppy: CedarUppy | null
  /** `Upload` ids of every file that finished, across batches. */
  completedUploads: string[]
  isUploading: boolean
}

/**
 * Shared plumbing for `useS3Upload` and `useFsUpload`: creates the Uppy
 * instance once per mount, re-applies restrictions when the token's
 * constraints arrive, tracks completion, and destroys the instance on
 * unmount. `create` runs once, so anything it closes over (an endpoint, a
 * presign callback) must read changing values through refs.
 */
export function useUppyUpload(
  create: () => Promise<CedarUppy>,
  constraints: UploadConstraints | null,
  { onUploadComplete, onUploadError }: UppyUploadCallbacks,
): UppyUploadResult {
  const [uppy, setUppy] = useState<CedarUppy | null>(null)
  const [completedUploads, setCompletedUploads] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const callbacks = useRef({ onUploadComplete, onUploadError })

  // Refs are updated in an effect, never during render, so a render React
  // discards cannot leave a stale callback behind
  useEffect(() => {
    callbacks.current = { onUploadComplete, onUploadError }
  }, [onUploadComplete, onUploadError])

  useEffect(() => {
    let instance: CedarUppy | null = null
    let cancelled = false

    create()
      .then((created) => {
        if (cancelled) {
          created.destroy()
          return
        }

        instance = created
        setUppy(created)
      })
      .catch((e: unknown) => {
        callbacks.current.onUploadError?.(
          e instanceof Error ? e : new Error(String(e)),
        )
      })

    return () => {
      cancelled = true
      instance?.destroy()
      setUppy(null)
    }
    // The instance is created once per mount; options are read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!uppy || !constraints) {
      return
    }

    uppy.setOptions({
      restrictions: {
        allowedFileTypes: constraints.allowedMimeTypes,
        maxFileSize: constraints.maxFileSize,
        maxNumberOfFiles: constraints.maxFiles,
      },
    })
  }, [uppy, constraints])

  useEffect(() => {
    if (!uppy) {
      return
    }

    const onStart = () => setIsUploading(true)

    const onComplete = (result: {
      successful?: CedarUppyFile[]
      failed?: CedarUppyFile[]
    }) => {
      setIsUploading(false)

      const ids = (result.successful ?? [])
        .map((file) => getCedarUploadId(uppy.getFile(file.id) ?? file))
        .filter((id): id is string => Boolean(id))

      if (ids.length > 0) {
        setCompletedUploads((prev) => [...prev, ...ids])
        callbacks.current.onUploadComplete?.(ids)
      }
    }

    const onError = (
      _file: CedarUppyFile | undefined,
      error: { name: string; message: string },
    ) => {
      setIsUploading(false)
      callbacks.current.onUploadError?.(
        error instanceof Error ? error : new Error(error.message),
      )
    }

    uppy.on('upload-start', onStart)
    uppy.on('complete', onComplete)
    uppy.on('upload-error', onError)

    return () => {
      uppy.off('upload-start', onStart)
      uppy.off('complete', onComplete)
      uppy.off('upload-error', onError)
    }
  }, [uppy])

  return { uppy, completedUploads, isUploading }
}
