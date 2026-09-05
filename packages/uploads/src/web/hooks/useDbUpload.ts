import { useCallback, useState } from 'react'

export interface DbUploadFile {
  filename: string
  mimeType: string
  /** Base64-encoded bytes. */
  data: string
  size: number
}

export interface UseDbUploadOptions {
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles?: number
  onFileReady?: (file: DbUploadFile) => void
}

export interface UseDbUploadResult {
  /** Reads one `File` as base64, validating type and size first. */
  readFile: (file: File) => Promise<DbUploadFile>
  /** Reads every file of a `FileList`, validating the count first. */
  readFiles: (files: FileList | File[]) => Promise<DbUploadFile[]>
  progress: { completed: number; total: number }
  isReading: boolean
}

function mimeTypeAllowed(allowed: string[], mimeType: string) {
  const normalized = mimeType.toLowerCase()

  return allowed.some((entry) => {
    const pattern = entry.toLowerCase()

    if (pattern === '*/*') {
      return true
    }

    if (pattern.endsWith('/*')) {
      return normalized.startsWith(pattern.slice(0, -1))
    }

    return pattern === normalized
  })
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * Reads small files as base64 for the DB upload path, which sends bytes
 * through a GraphQL mutation to `storeFile()`. No Uppy involved. The checks
 * here are UX only; the service enforces the real limits.
 */
export function useDbUpload({
  allowedMimeTypes,
  maxFileSize,
  maxFiles,
  onFileReady,
}: UseDbUploadOptions): UseDbUploadResult {
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [isReading, setIsReading] = useState(false)

  const readFile = useCallback(
    async (file: File): Promise<DbUploadFile> => {
      if (!mimeTypeAllowed(allowedMimeTypes, file.type)) {
        throw new Error(`File type '${file.type}' is not allowed.`)
      }

      if (file.size > maxFileSize) {
        throw new Error(
          `File is ${file.size} bytes, which exceeds the ${maxFileSize} byte limit.`,
        )
      }

      const result: DbUploadFile = {
        filename: file.name,
        mimeType: file.type,
        data: await readAsBase64(file),
        size: file.size,
      }

      onFileReady?.(result)

      return result
    },
    [allowedMimeTypes, maxFileSize, onFileReady],
  )

  const readFiles = useCallback(
    async (files: FileList | File[]): Promise<DbUploadFile[]> => {
      const list = Array.from(files)

      if (maxFiles !== undefined && list.length > maxFiles) {
        throw new Error(`At most ${maxFiles} file(s) can be selected.`)
      }

      setIsReading(true)
      setProgress({ completed: 0, total: list.length })

      try {
        const results: DbUploadFile[] = []

        for (const file of list) {
          results.push(await readFile(file))
          setProgress({ completed: results.length, total: list.length })
        }

        return results
      } finally {
        setIsReading(false)
      }
    },
    [maxFiles, readFile],
  )

  return { readFile, readFiles, progress, isReading }
}
