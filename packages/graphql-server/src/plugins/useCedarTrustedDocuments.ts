import { usePersistedOperations } from '@graphql-yoga/plugin-persisted-operations'
import type { UsePersistedOperationsOptions } from '@graphql-yoga/plugin-persisted-operations'
import type { GraphQLParams, Plugin } from 'graphql-yoga'

import type { CedarGraphQLContext } from '../types.js'

export type CedarTrustedDocumentOptions = Omit<
  UsePersistedOperationsOptions,
  'getPersistedOperation'
> & {
  /**
   * Whether to disable the plugin
   * @default false
   */
  disabled?: boolean

  /**
   * The store to get the persisted operation hash from
   * Required when the plugin is not disabled
   */
  store?: Readonly<Record<string, string>>
} & (
    | { disabled: true; store?: Readonly<Record<string, string>> }
    | { disabled?: false; store: Readonly<Record<string, string>> }
  )

/** @deprecated Use `CedarTrustedDocumentOptions` instead. */
export type RedwoodTrustedDocumentOptions = CedarTrustedDocumentOptions

const CEDAR__AUTH_GET_CURRENT_USER_QUERY =
  'query __CEDAR__AUTH_GET_CURRENT_USER { cedar { currentUser } }'
const CEDAR__STUDIO_RESYNC_MAIL_RENDERERS_MUTATION =
  'mutation { resyncMailRenderers }'
const CEDAR__STUDIO_TEMPLATE_MUTATION = 'mutation { resyncMailTemplate }'

/**
 * When using Cedar Auth, we want to allow the known, trusted `cedar.currentUser` query to be
 * executed without a persisted operation.
 *
 * This is because the `currentUser` query is a special case that is used to get
 * the current user from the auth provider.
 *
 * This function checks if the request is for the `currentUser` query and has the correct headers
 * which are set by the useCurrentUser hook in the auth package.
 *
 * The usePersistedOperations plugin relies on this function to determine if a request
 * should be allowed to execute via its allowArbitraryOperations option.
 */
const allowCedarAuthCurrentUserQuery = (
  request: Request,
  params: GraphQLParams | undefined,
) => {
  const headers = request.headers
  const hasContentType = headers.get('content-type') === 'application/json'
  const hasAuthProvider = !!headers.get('auth-provider')
  const hasAuthorization = !!headers.get('authorization')
  const hasAllowedHeaders =
    hasContentType && hasAuthProvider && hasAuthorization

  const hasAllowedQuery = params?.query === CEDAR__AUTH_GET_CURRENT_USER_QUERY

  return hasAllowedHeaders && hasAllowedQuery
}

/**
 * When using Studio, we want to allow the `resyncMailRenderers` and
 * `resyncMailTemplate` mutations to be executed without a persisted operation.
 * This is only allowed in local development, ensure you have
 * NODE_ENV=development set.
 *
 * This is because the `resyncMailRenderers` mutation is a special case that is
 * used by Studio to sync mail renderers from the mailer configuration.
 *
 * This function checks if the request is for the `resyncMailRenderers` or
 * `resyncMailTemplate` mutations and has the correct headers.
 *
 * If you need Studio in production, you just have to add the above mutations to
 * your SDL schema and as dummy resolvers so Trusted Documents can pick them up.
 */
const allowCedarStudioResyncMailMutations = (
  request: Request,
  params: GraphQLParams | undefined,
) => {
  const isLocalDevelopment = process.env.NODE_ENV === 'development'
  if (!isLocalDevelopment) {
    return false
  }

  const headers = request.headers
  const hasContentType = headers.get('content-type') === 'application/json'

  const isAllowedQuery =
    params?.query === CEDAR__STUDIO_RESYNC_MAIL_RENDERERS_MUTATION ||
    params?.query === CEDAR__STUDIO_TEMPLATE_MUTATION

  return hasContentType && isAllowedQuery
}

export const useCedarTrustedDocuments = (
  options: CedarTrustedDocumentOptions,
): Plugin<CedarGraphQLContext> => {
  // `allowArbitraryOperations` is only handed the `Request`, but by the time it
  // runs Yoga has already consumed the request body to build `params`. Reading
  // it a second time throws `TypeError: Body is unusable: Body has already been
  // read`, and `request.clone()` throws too because the body is disturbed. So
  // stash the parsed params from `onParams` and let the allow-list inspect the
  // operation without ever touching the body again.
  const paramsByRequest = new WeakMap<Request, GraphQLParams>()

  const persistedOperations = usePersistedOperations({
    ...options,
    customErrors: {
      persistedQueryOnly: 'Use Trusted Only!',
      ...options.customErrors,
    },
    getPersistedOperation(sha256Hash: string) {
      return options.store ? options.store[sha256Hash] : null
    },
    allowArbitraryOperations: async (request) => {
      if (options.allowArbitraryOperations !== undefined) {
        if (typeof options.allowArbitraryOperations === 'boolean') {
          if (options.allowArbitraryOperations) {
            return true
          }
        }
        if (typeof options.allowArbitraryOperations === 'function') {
          const result = await options.allowArbitraryOperations(request)
          if (result === true) {
            return true
          }
        }
      }

      const params = paramsByRequest.get(request)

      return (
        allowCedarAuthCurrentUserQuery(request, params) ||
        allowCedarStudioResyncMailMutations(request, params)
      )
    },
  })

  return {
    ...persistedOperations,
    onParams(payload) {
      paramsByRequest.set(payload.request, payload.params)

      return persistedOperations.onParams?.(payload)
    },
  }
}
