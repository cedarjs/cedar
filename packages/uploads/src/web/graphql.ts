import { gql } from '@apollo/client'

/**
 * Constraints echoed with an upload token. The authoritative copy is inside
 * the signed token; these are for client-side UX only.
 */
export interface UploadConstraints {
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles: number
}

export interface RequestUploadTokenData {
  requestUploadToken: {
    token: string
    allowedMimeTypes: string[]
    maxFileSize: string | number
    maxFiles: number
  }
}

export interface RequestUploadTokenVariables {
  profile: string
}

export const REQUEST_UPLOAD_TOKEN = gql`
  query CedarRequestUploadToken($profile: String!) {
    requestUploadToken(profile: $profile) {
      token
      allowedMimeTypes
      maxFileSize
      maxFiles
    }
  }
`

export interface CreatePresignedUploadUrlData {
  createPresignedUploadUrl: {
    uploadId: string
    url: string
    method: string
    headers: Record<string, string>
  }
}

export interface CreatePresignedUploadUrlVariables {
  input: {
    filename: string
    contentType: string
    size: string
  }
}

export const CREATE_PRESIGNED_UPLOAD_URL = gql`
  mutation CedarCreatePresignedUploadUrl(
    $input: CreatePresignedUploadUrlInput!
  ) {
    createPresignedUploadUrl(input: $input) {
      uploadId
      url
      method
      headers
    }
  }
`

export interface ConfirmUploadData {
  confirmUpload: {
    id: string
    status: string
  }
}

export interface ConfirmUploadVariables {
  uploadId: string
}

export const CONFIRM_UPLOAD = gql`
  mutation CedarConfirmUpload($uploadId: String!) {
    confirmUpload(uploadId: $uploadId) {
      id
      status
    }
  }
`
