import type { ChangeEvent, InputHTMLAttributes } from 'react'

import { useDbUpload } from '../hooks/useDbUpload.js'
import type { DbUploadFile } from '../hooks/useDbUpload.js'

export interface DbInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'accept' | 'multiple' | 'onError'
> {
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles?: number
  /** Called with every selected file read as base64. */
  onFilesReady?: (files: DbUploadFile[]) => void
  /** Called when a selected file fails validation or cannot be read. */
  onReadError?: (error: Error) => void
}

/**
 * A file input for the DB upload path. Selected files are validated against
 * the profile's constraints and read as base64, ready to send through a
 * GraphQL mutation to `storeFile()`.
 */
export function DbInput({
  allowedMimeTypes,
  maxFileSize,
  maxFiles = 1,
  onFilesReady,
  onReadError,
  disabled,
  ...inputProps
}: DbInputProps) {
  const { readFiles, isReading } = useDbUpload({
    allowedMimeTypes,
    maxFileSize,
    maxFiles,
  })

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files

    if (!files || files.length === 0) {
      return
    }

    try {
      const ready = await readFiles(files)
      onFilesReady?.(ready)
    } catch (e) {
      onReadError?.(e instanceof Error ? e : new Error(String(e)))
    }
  }

  return (
    <input
      {...inputProps}
      type="file"
      accept={allowedMimeTypes.join(',')}
      multiple={maxFiles > 1}
      disabled={disabled || isReading}
      onChange={onChange}
    />
  )
}
