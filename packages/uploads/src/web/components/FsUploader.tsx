import { useFsUpload } from '../hooks/useFsUpload.js'
import type { UseFsUploadOptions } from '../hooks/useFsUpload.js'

import { UppyUploader } from './UppyUploader.js'
import type { UppyUploaderProps } from './UppyUploader.js'

export type FsUploaderProps = UseFsUploadOptions &
  Omit<UppyUploaderProps, 'uppy'>

/** Through-the-api uploader for FS targets: `useFsUpload` wired to an Uppy UI. */
export function FsUploader({
  profile,
  endpoint,
  onUploadComplete,
  onUploadError,
  ...uiProps
}: FsUploaderProps) {
  const { uppy } = useFsUpload({
    profile,
    endpoint,
    onUploadComplete,
    onUploadError,
  })

  return <UppyUploader uppy={uppy} {...uiProps} />
}
