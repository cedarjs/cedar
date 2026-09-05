import type { FastifyRequest } from 'fastify'

import { getAuthenticationContext } from '@cedarjs/api'
import type { Decoder } from '@cedarjs/api'

/** The identity an upload route resolves for a request. */
export interface UploadRequestUser {
  id: string
  organizationId?: string
}

export type UploadAuthenticator = (
  req: FastifyRequest,
) => Promise<UploadRequestUser | null>

export interface CreateUploadAuthenticatorOptions {
  /** The app's auth decoder, for example from `@cedarjs/auth-dbauth-api`. */
  authDecoder: Decoder | Decoder[]
  /**
   * The app's `getCurrentUser`, as exported from `api/src/lib/auth`. It
   * receives the decoded session exactly as the GraphQL server passes it.
   */
  getCurrentUser: (
    decoded: unknown,
    raw: { type: string; schema: string; token: string },
    req: { event: Request; request: Request },
  ) => Promise<unknown>
  /**
   * Picks the organization id off the current user, for multi-tenant apps.
   * Defaults to a top-level `organizationId` property when present.
   */
  getOrganizationId?: (currentUser: unknown) => string | undefined
}

function toWebRequest(req: FastifyRequest): Request {
  const headers = new Headers()

  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value)
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(', '))
    }
  }

  const host = req.headers.host ?? 'localhost'

  return new Request(`${req.protocol}://${host}${req.url}`, {
    method: 'GET',
    headers,
  })
}

function defaultOrganizationId(user: unknown): string | undefined {
  if (
    typeof user === 'object' &&
    user !== null &&
    'organizationId' in user &&
    typeof user.organizationId === 'string'
  ) {
    return user.organizationId
  }

  return undefined
}

/**
 * Builds the `authenticate` callback for the upload plugin from the same
 * pieces the GraphQL server uses: the request's auth header is decoded with
 * the app's auth decoder and the result handed to the app's
 * `getCurrentUser`. With it in place the upload routes reject a token whose
 * `sub` belongs to someone other than the requester.
 */
export function createUploadAuthenticator({
  authDecoder,
  getCurrentUser,
  getOrganizationId = defaultOrganizationId,
}: CreateUploadAuthenticatorOptions): UploadAuthenticator {
  return async (req) => {
    const request = toWebRequest(req)
    const authContext = await getAuthenticationContext({
      authDecoder,
      event: request,
    })

    if (!authContext) {
      return null
    }

    const [decoded, raw] = authContext
    const user = await getCurrentUser(decoded, raw, { event: request, request })

    if (
      typeof user !== 'object' ||
      user === null ||
      !('id' in user) ||
      (typeof user.id !== 'string' && typeof user.id !== 'number')
    ) {
      return null
    }

    const organizationId = getOrganizationId(user)

    return {
      id: String(user.id),
      ...(organizationId ? { organizationId } : {}),
    }
  }
}
