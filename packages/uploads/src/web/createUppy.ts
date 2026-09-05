import Uppy from '@uppy/core'
import type { Meta, UppyFile } from '@uppy/core'

import { UPLOAD_TOKEN_HEADER } from '../constants.js'

import type { UploadConstraints } from './graphql.js'

/** The Uppy instance type every Cedar hook and component works with. */
export type CedarUppy = Uppy

/** A file inside a `CedarUppy` instance. */
export type CedarUppyFile = UppyFile<Meta, Record<string, never>>

export { UPLOAD_TOKEN_HEADER } from '../constants.js'

/** Route the FS uploader posts to, relative to the api origin. */
export const DEFAULT_FS_UPLOAD_PATH = '/upload/fs'

export interface BaseUppyOptions {
  /** Constraints from the upload token, applied as Uppy restrictions. */
  constraints?: UploadConstraints | null
  /** Start uploading as soon as files are added. Defaults to `true`. */
  autoProceed?: boolean
  debug?: boolean
}

/**
 * One file's `{ url, method, headers }` from the api, plus the id of the
 * pending `Upload` row it belongs to.
 */
export interface PresignedUploadParameters {
  uploadId: string
  url: string
  method: string
  headers: Record<string, string>
}

export interface S3UppyOptions extends BaseUppyOptions {
  provider: 's3'
  /**
   * Asks the api for a presigned URL for one file. Called once per file
   * with the file's name, type, and size.
   */
  getUploadParameters: (
    file: CedarUppyFile,
  ) => Promise<PresignedUploadParameters>
}

export interface FsUppyOptions extends BaseUppyOptions {
  provider: 'fs'
  /** Full URL of the api's `POST {prefix}/fs` route, or a function returning it. */
  endpoint: string | (() => string)
  /** The upload token to send. Called per request so a refreshed token is used. */
  getUploadToken: () => string | null
}

export type CreateUppyOptions = S3UppyOptions | FsUppyOptions

/** Response body of the api's `POST {prefix}/fs` route. */
export interface FsUploadResponseBody {
  uploads: { id: string; status: string; filename: string }[]
}

function restrictionsFor(constraints: UploadConstraints | null | undefined) {
  if (!constraints) {
    return {}
  }

  return {
    allowedFileTypes: constraints.allowedMimeTypes,
    maxFileSize: constraints.maxFileSize,
    maxNumberOfFiles: constraints.maxFiles,
  }
}

/**
 * Creates an Uppy instance pre-configured for one of Cedar's upload flows.
 * Direct-to-S3 uploads use `@uppy/aws-s3` with the presigned URLs the api
 * hands out; FS uploads use `@uppy/xhr-upload` against the api's upload
 * route. The matching plugin is loaded on demand, so only the one in use
 * needs to be installed.
 */
export async function createUppy(
  options: CreateUppyOptions,
): Promise<CedarUppy> {
  const { constraints, autoProceed = true, debug = false } = options

  const uppy = new Uppy({
    autoProceed,
    debug,
    restrictions: restrictionsFor(constraints),
  })

  if (options.provider === 's3') {
    const { default: AwsS3 } = await import('@uppy/aws-s3')

    uppy.use(AwsS3, {
      shouldUseMultipart: false,
      // The S3 plugin signs by object key, not by file, so the key is set to
      // the Uppy file id and the file looked up from it inside `signRequest`.
      // The server chooses the real object key.
      generateObjectKey: (file) => file.id,
      signRequest: async (request) => {
        if (request.method !== 'PUT' || 'uploadId' in request) {
          throw new Error(
            `Cedar presigned uploads only support single PUT requests, ` +
              `got ${request.method}.`,
          )
        }

        const file = uppy.getFile(request.key)

        if (!file) {
          throw new Error(`Unknown file '${request.key}'.`)
        }

        const params = await options.getUploadParameters(file)
        uppy.setFileMeta(file.id, { cedarUploadId: params.uploadId })

        return { url: params.url }
      },
    })

    return uppy
  }

  const { default: XHRUpload } = await import('@uppy/xhr-upload')

  const { endpoint } = options

  uppy.use(XHRUpload, {
    endpoint: typeof endpoint === 'function' ? () => endpoint() : endpoint,
    method: 'POST',
    formData: true,
    fieldName: 'file',
    bundle: false,
    headers: () => {
      const headers: Record<string, string> = {}
      const token = options.getUploadToken()

      if (token) {
        headers[UPLOAD_TOKEN_HEADER] = token
      }

      return headers
    },
  })

  uppy.on('upload-success', (file, response) => {
    // Uppy types the body as an empty record; the FS route returns JSON
    const body = response.body as unknown as FsUploadResponseBody | undefined
    const id = body?.uploads?.[0]?.id

    if (file && id) {
      uppy.setFileMeta(file.id, { cedarUploadId: id })
    }
  })

  return uppy
}

/** Reads the `Upload` id Cedar recorded on a file after it uploaded. */
export function getCedarUploadId(file: CedarUppyFile): string | null {
  const id = file.meta.cedarUploadId

  return typeof id === 'string' ? id : null
}
