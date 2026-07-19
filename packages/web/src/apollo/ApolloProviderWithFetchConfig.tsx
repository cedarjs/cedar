import React from 'react'

import type { ApolloCache, DocumentNode, setLogVerbosity } from '@apollo/client'
import {
  ApolloClient,
  ApolloLink,
  setLogVerbosity as apolloSetLogVerbosity,
  split,
} from '@apollo/client'
import { SetContextLink } from '@apollo/client/link/context'
import { PersistedQueryLink } from '@apollo/client/link/persisted-queries'
import { ApolloProvider } from '@apollo/client/react'
import { getMainDefinition } from '@apollo/client/utilities'
import { print } from 'graphql/language/printer.js'
import { map } from 'rxjs'

import type { UseAuth } from '@cedarjs/auth'
import { useNoAuth } from '@cedarjs/auth'

import { UploadHttpLink } from '../bundled/apollo-upload-client.js'
import { useFetchConfig } from '../components/FetchConfigProvider.js'

import type {
  CedarApolloLinks,
  GraphQLClientConfigProp,
} from './apolloLinkTypes.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import * as SSELinkExports from './sseLink.js'

// Not sure why we need to import it this way for legacy builds to work
const { SSELink, isSubscription, isLiveQuery } = SSELinkExports

// `updateDataApolloLink` keeps track of the most recent req/res data so they can be passed to
// any errors passed up to an error boundary.
type ApolloRequestData = {
  mostRecentRequest?: {
    operationName?: string
    operationKind?: string
    variables?: Record<string, unknown>
    query?: string
  }
  mostRecentResponse?: any
}

/**
 * Use Trusted Documents aka Persisted Operations aka Queries
 *
 * When detecting a meta hash, Apollo Client will send the hash from the
 * document and not the query itself.
 *
 * You must configure your GraphQL server to support this feature with the
 * useTrustedDocuments option.
 *
 * See https://www.apollographql.com/docs/react/data/persisted-queries
 */
interface DocumentNodeWithMeta extends DocumentNode {
  __meta__?: {
    hash: string
  }
}

interface Props {
  config: Omit<GraphQLClientConfigProp, 'cacheConfig' | 'cache'> & {
    cache: ApolloCache
  }
  useAuth?: UseAuth
  logLevel: ReturnType<typeof setLogVerbosity>
  children: React.ReactNode
}

export function ApolloProviderWithFetchConfig({
  config,
  children,
  useAuth = useNoAuth,
  logLevel,
}: Props) {
  // Should they run into it, this helps users with the "Cannot render cell; GraphQL success but data is null" error.
  // See https://github.com/redwoodjs/redwood/issues/2473.
  apolloSetLogVerbosity(logLevel)

  // Here we're using Apollo Link to customize Apollo Client's data flow.
  // Although we're sending conventional HTTP-based requests and could just pass `uri` instead of `link`,
  // we need to fetch a new token on every request, making middleware a good fit for this.
  //
  // See https://www.apollographql.com/docs/react/api/link/introduction.
  const { getToken, type: authProviderType } = useAuth()

  const data = {
    mostRecentRequest: undefined,
    mostRecentResponse: undefined,
  } as ApolloRequestData

  const updateDataApolloLink = new ApolloLink((operation, forward) => {
    const { operationName, query, variables } = operation

    data.mostRecentRequest = {}
    data.mostRecentRequest.operationName = operationName
    data.mostRecentRequest.operationKind = query?.kind.toString()
    data.mostRecentRequest.variables = variables
    data.mostRecentRequest.query = query && print(operation.query)

    return forward(operation).pipe(
      map((result) => {
        data.mostRecentResponse = result

        return result
      }),
    )
  })

  const withToken = new SetContextLink(async () => {
    const token = await getToken()

    return { token }
  })

  const { headers, uri } = useFetchConfig()

  const authMiddleware = new ApolloLink((operation, forward) => {
    const { token } = operation.getContext()

    // Only add auth headers when there's a token. `token` is `null` when `!isAuthenticated`.
    const authHeaders = token
      ? {
          'auth-provider': authProviderType,
          authorization: `Bearer ${token}`,
        }
      : {}

    operation.setContext(() => ({
      headers: {
        ...operation.getContext().headers,
        ...headers,
        // Duped auth headers, because we may remove the `FetchConfigProvider` at a later date.
        ...authHeaders,
      },
    }))

    return forward(operation)
  })

  const { httpLinkConfig, link: cedarApolloLink, ...rest } = config ?? {}

  // A terminating link. Apollo Client uses this to send GraphQL operations to a server over HTTP.
  // See https://www.apollographql.com/docs/react/api/link/introduction/#the-terminating-link.
  // Internally uploadLink determines whether to use form-data vs http link
  const uploadLink: ApolloLink = new UploadHttpLink({
    uri,
    ...httpLinkConfig,
  })

  // Our terminating link needs to be smart enough to handle subscriptions, and
  // if the GraphQL query is subscription it needs to use the SSELink (server
  // sent events link).
  const uploadOrSSELink =
    typeof SSELink !== 'undefined'
      ? split(
          ({ query }) => {
            const definition = getMainDefinition(query)

            return isSubscription(definition) || isLiveQuery(definition)
          },
          new SSELink({
            url: uri,
            auth: { authProviderType, tokenFn: getToken },
            httpLinkConfig,
            headers,
          }),
          uploadLink,
        )
      : uploadLink

  // Check if the query made includes the hash, and if so then make the request
  // with the persisted query link
  const terminatingLink = split(
    ({ query }) => {
      const documentQuery = query as DocumentNodeWithMeta
      return documentQuery?.['__meta__']?.['hash'] !== undefined
    },
    new PersistedQueryLink({
      generateHash: (document: DocumentNode) => {
        // The split above guarantees that only documents with a `__meta__`
        // hash are sent through this link
        const documentWithMeta: DocumentNodeWithMeta = document
        return documentWithMeta.__meta__?.hash ?? ''
      },
    }).concat(uploadOrSSELink),
    uploadOrSSELink,
  )

  // The order here is important. The last link *must* be a terminating link
  // like HttpLink, SSELink, or the PersistedQueryLink.
  const cedarApolloLinks: CedarApolloLinks = [
    { name: 'withToken', link: withToken },
    { name: 'authMiddleware', link: authMiddleware },
    { name: 'updateDataApolloLink', link: updateDataApolloLink },
    { name: 'httpLink', link: terminatingLink },
  ]

  let link = cedarApolloLink

  link ??= ApolloLink.from(cedarApolloLinks.map((l) => l.link))

  if (typeof link === 'function') {
    link = link(cedarApolloLinks)
  }

  const client = new ApolloClient({
    // Default options for every Cell. Better to specify them here than in
    // `beforeQuery` where it's too easy to overwrite them.
    // See https://www.apollographql.com/docs/react/api/core/ApolloClient/#example-defaultoptions-object.
    defaultOptions: {
      watchQuery: {
        // The `fetchPolicy` we expect:
        //
        // > Apollo Client executes the full query against both the cache and
        // > your GraphQL server.
        // > The query automatically updates if the result of the server-side
        // > query modifies cached fields.
        //
        // See https://www.apollographql.com/docs/react/data/queries/#cache-and-network.
        fetchPolicy: 'cache-and-network',
        // So that Cells rerender when refetching.
        // See https://www.apollographql.com/docs/react/data/queries/#inspecting-loading-states.
        notifyOnNetworkStatusChange: true,
      },
    },
    link,
    ...rest,
  })

  const extendErrorAndRethrow = (error: any, _errorInfo: React.ErrorInfo) => {
    error['mostRecentRequest'] = data.mostRecentRequest
    error['mostRecentResponse'] = data.mostRecentResponse
    throw error
  }

  return (
    <ApolloProvider client={client}>
      <ErrorBoundary onError={extendErrorAndRethrow}>{children}</ErrorBoundary>
    </ApolloProvider>
  )
}
