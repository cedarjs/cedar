import { useS3Upload } from '../hooks/useS3Upload.js'
import type { UseS3UploadOptions } from '../hooks/useS3Upload.js'

import { UppyUploader } from './UppyUploader.js'
import type { UppyUploaderProps } from './UppyUploader.js'

export type S3UploaderProps = UseS3UploadOptions &
  Omit<UppyUploaderProps, 'uppy'>

/** Direct-to-S3 uploader: `useS3Upload` wired to an Uppy UI. */
export function S3Uploader({
  profile,
  confirm,
  onUploadComplete,
  onUploadError,
  ...uiProps
}: S3UploaderProps) {
  const { uppy } = useS3Upload({
    profile,
    confirm,
    onUploadComplete,
    onUploadError,
  })

  return <UppyUploader uppy={uppy} {...uiProps} />
}
