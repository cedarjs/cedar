import type { APIGatewayProxyEvent } from 'aws-lambda'
import { parse } from 'graphql'

import { getEventHeader } from '@cedarjs/api'
import {
  AuthenticationError,
  createTransformerDirective,
  createValidatorDirective,
  ForbiddenError,
} from '@cedarjs/graphql-server'
import type {
  TransformerDirective,
  ValidatorDirective,
  ValidatorDirectiveFunc,
} from '@cedarjs/graphql-server'

import { UploadError } from './errors.js'
import { toDataUri } from './serialize.js'
import { resolveTarget } from './targets.js'
import type {
  ContentDisposition,
  StorageTargets,
  UploadDatabase,
  UploadRecord,
} from './types.js'
import { loadUpload } from './uploadLoader.js'
import { UPLOAD_TOKEN_HEADER, verifyUploadToken } from './uploadToken.js'
import type { UploadTokenPayload } from './uploadToken.js'

/** Context key `@requireUploadToken` stores the validated token under. */
export const UPLOAD_TOKEN_CONTEXT_KEY = 'uploadTokenPayload'

/**
 * Reads the validated upload token `@requireUploadToken` attached to the
 * GraphQL context. Throws when the resolver runs without the directive.
 */
export function getUploadTokenPayload(
  context: Record<string, unknown>,
): UploadTokenPayload {
  const payload = context[UPLOAD_TOKEN_CONTEXT_KEY]

  if (!payload) {
    throw new UploadError(
      'INVALID_TOKEN',
      'No validated upload token on the GraphQL context. Add the ' +
        '`@requireUploadToken` directive to this field.',
    )
  }

  return payload as UploadTokenPayload
}

type Actor = { id: string | number; organizationId?: string | null }

/** The GraphQL context, as directives receive it. */
export type DirectiveContext = Record<string, unknown>

function isLambdaEvent(value: unknown): value is APIGatewayProxyEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'headers' in value &&
    typeof value.headers === 'object'
  )
}

function requestSourceOf(
  context: DirectiveContext,
): Request | APIGatewayProxyEvent | null {
  if (context.request instanceof Request) {
    return context.request
  }

  if (isLambdaEvent(context.event)) {
    return context.event
  }

  return null
}

function currentUserOf(context: DirectiveContext): Actor | null {
  const user = context.currentUser

  if (!user || typeof user !== 'object' || !('id' in user)) {
    return null
  }

  const id = user.id

  if (typeof id !== 'string' && typeof id !== 'number') {
    return null
  }

  const organizationId =
    'organizationId' in user && typeof user.organizationId === 'string'
      ? user.organizationId
      : null

  return { id, organizationId }
}

export interface RequireUploadTokenDirectiveOptions {
  /** Secret upload tokens were signed with. */
  secret: string
  /**
   * Resolves the organization the request is acting under, for multi-tenant
   * apps. Defaults to `context.currentUser.organizationId`.
   */
  getOrganizationId?: (context: DirectiveContext) => string | null | undefined
}

export const requireUploadTokenSchema = parse(`
  """
  Use to require a valid upload token in the x-upload-token request header.
  The token is bound to the user it was issued to.
  """
  directive @requireUploadToken on FIELD_DEFINITION
`)

/**
 * Builds the `@requireUploadToken` validator directive. It verifies the
 * token in the `x-upload-token` header, rejects a token issued to a
 * different user or organization, and attaches the claims to the context
 * for `getUploadTokenPayload()`.
 */
export function createRequireUploadTokenDirective({
  secret,
  getOrganizationId,
}: RequireUploadTokenDirectiveOptions): ValidatorDirective {
  const validate: ValidatorDirectiveFunc = ({ context }) => {
    const source = requestSourceOf(context)
    const header = source ? getEventHeader(source, UPLOAD_TOKEN_HEADER) : null

    if (!header) {
      throw new AuthenticationError('Missing upload token.')
    }

    let payload: UploadTokenPayload

    try {
      payload = verifyUploadToken(header, { secret })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new AuthenticationError(message)
    }

    const user = currentUserOf(context)

    if (user && String(user.id) !== payload.sub) {
      throw new ForbiddenError('Upload token was issued to a different user.')
    }

    const organizationId = getOrganizationId
      ? getOrganizationId(context)
      : user?.organizationId

    if (payload.organizationId && payload.organizationId !== organizationId) {
      throw new ForbiddenError(
        'Upload token was issued for a different organization.',
      )
    }

    context[UPLOAD_TOKEN_CONTEXT_KEY] = payload
  }

  return createValidatorDirective(requireUploadTokenSchema, validate)
}

export interface UploadUrlDirectiveOptions {
  db: UploadDatabase
  targets: StorageTargets
}

export interface WithSignedUrlDirectiveOptions extends UploadUrlDirectiveOptions {
  /** Lifetime of generated URLs, in seconds. Provider default when unset. */
  expiresIn?: number
  /** Defaults to `attachment`. */
  disposition?: ContentDisposition
}

export const withSignedUrlSchema = parse(`
  """
  Use on a field that holds an Upload id to resolve it to a time-limited URL
  for the stored file.
  """
  directive @withSignedUrl on FIELD_DEFINITION
`)

async function loadCompletedUpload(
  context: DirectiveContext,
  db: UploadDatabase,
  resolvedValue: unknown,
): Promise<UploadRecord | null> {
  if (typeof resolvedValue !== 'string' || resolvedValue.length === 0) {
    return null
  }

  const upload = await loadUpload(context, db, resolvedValue)

  if (upload?.status !== 'completed') {
    return null
  }

  return upload
}

async function loadInlineData(
  db: UploadDatabase,
  upload: UploadRecord,
): Promise<Uint8Array | null> {
  const row = await db.upload.findUnique({ where: { id: upload.id } })

  return row?.data ?? null
}

/**
 * Builds the `@withSignedUrl` transformer directive. It turns an Upload id
 * stored in a field into a signed URL from the row's target, or a `data:`
 * URI when the target is the DB provider. Lookups are batched per request
 * and never fetch inline `data` for object-storage rows.
 */
export function createWithSignedUrlDirective({
  db,
  targets,
  expiresIn,
  disposition,
}: WithSignedUrlDirectiveOptions): TransformerDirective {
  return createTransformerDirective(
    withSignedUrlSchema,
    async ({ context, resolvedValue }) => {
      const upload = await loadCompletedUpload(context, db, resolvedValue)

      if (!upload) {
        return null
      }

      const target = resolveTarget(targets, upload.target)

      if (target.providerType === 'db') {
        const data = await loadInlineData(db, upload)
        return data ? toDataUri(upload.mimeType, data) : null
      }

      if (!upload.storageKey) {
        return null
      }

      return target.getSignedReadUrl(upload.storageKey, {
        expiresIn,
        disposition,
      })
    },
  )
}

export const withDataUriSchema = parse(`
  """
  Use on a field that holds an Upload id to resolve it to a data: URI of the
  file's bytes. Suitable for small files only.
  """
  directive @withDataUri on FIELD_DEFINITION
`)

/**
 * Builds the `@withDataUri` transformer directive. It reads the file from
 * whichever target holds it and returns a base64 `data:` URI. Use it for
 * small files only; every resolved field embeds the whole file.
 */
export function createWithDataUriDirective({
  db,
  targets,
}: UploadUrlDirectiveOptions): TransformerDirective {
  return createTransformerDirective(
    withDataUriSchema,
    async ({ context, resolvedValue }) => {
      const upload = await loadCompletedUpload(context, db, resolvedValue)

      if (!upload) {
        return null
      }

      const target = resolveTarget(targets, upload.target)

      const data =
        target.providerType === 'db'
          ? await loadInlineData(db, upload)
          : upload.storageKey
            ? await target.read(upload.storageKey)
            : null

      return data ? toDataUri(upload.mimeType, data) : null
    },
  )
}
