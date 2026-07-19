import type { HttpLink } from '@apollo/client'
import { ApolloLink } from '@apollo/client'
import type { DefinitionNode } from 'graphql'
import { Kind, OperationTypeNode, print } from 'graphql'
import type { ClientOptions, Client, RequestParams, Sink } from 'graphql-sse'
import { createClient } from 'graphql-sse'
import { Observable } from 'rxjs'
interface SSELinkOptions extends Partial<ClientOptions> {
  url: string
  auth: { authProviderType: string; tokenFn: () => Promise<null | string> }
  httpLinkConfig?: HttpLink.Options
  headers?: Record<string, string>
}

const mapCredentialsHeader = (
  httpLinkCredentials?: string,
): 'omit' | 'same-origin' | 'include' | undefined => {
  if (!httpLinkCredentials) {
    return undefined
  }
  switch (httpLinkCredentials) {
    case 'omit':
    case 'same-origin':
    case 'include':
      return httpLinkCredentials
    default:
      return undefined
  }
}

const mapReferrerPolicyHeader = (
  referrerPolicy?: string,
):
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'same-origin'
  | 'origin'
  | 'strict-origin'
  | 'origin-when-cross-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'
  | undefined => {
  if (!referrerPolicy) {
    return undefined
  }
  switch (referrerPolicy) {
    case 'no-referrer':
    case 'no-referrer-when-downgrade':
    case 'same-origin':
    case 'origin':
    case 'strict-origin':
    case 'origin-when-cross-origin':
    case 'strict-origin-when-cross-origin':
    case 'unsafe-url':
      return referrerPolicy
    default:
      return undefined
  }
}

// Check if the operation has a persisted query (aka trusted document)
// by checking if the operation has an `extensions` property and if it has a `persistedQuery` property.
const hasTrustedDocument = (operation: ApolloLink.Operation) => {
  return operation.extensions?.persistedQuery?.sha256Hash
}

const isSubscription = (definition: DefinitionNode) => {
  return (
    definition.kind === Kind.OPERATION_DEFINITION &&
    definition.operation === OperationTypeNode.SUBSCRIPTION
  )
}

// This is a simplified version of the `@n1ru4l/graphql-live-query`.
// See discussion in https://github.com/redwoodjs/redwood/pull/11375
const isLiveQuery = (definition: DefinitionNode) => {
  if (
    definition.kind !== Kind.OPERATION_DEFINITION ||
    definition.operation !== OperationTypeNode.QUERY
  ) {
    return false
  }

  return !!definition.directives?.find((d) => d.name.value === 'live')
}

/**
 * GraphQL over Server-Sent Events (SSE) spec link for Apollo Client
 */
class SSELink extends ApolloLink {
  private client: Client

  constructor(options: SSELinkOptions) {
    super()

    const { url, auth, headers, httpLinkConfig } = options
    const { credentials, referrer, referrerPolicy, ...customHeaders } =
      httpLinkConfig?.headers || {}

    this.client = createClient({
      url,
      headers: async () => {
        const token = await auth.tokenFn()

        // Only add auth headers when there's a token. `token` is `null` when
        // `!isAuthenticated`.
        return {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(token && { 'auth-provider': auth.authProviderType }),
          ...headers,
          ...customHeaders,
        }
      },
      credentials: mapCredentialsHeader(credentials),
      referrer,
      referrerPolicy: mapReferrerPolicyHeader(referrerPolicy),
    })
  }

  public request(
    operation: ApolloLink.Operation & { query?: any },
  ): Observable<ApolloLink.Result> {
    return new Observable<ApolloLink.Result>((sink: Sink) => {
      let request: RequestParams

      // If the operation has a persisted query (aka trusted document),
      // we don't need to send the query as a string.
      if (hasTrustedDocument(operation)) {
        delete operation.query
        request = { ...operation }
      } else {
        request = {
          ...operation,
          query: print(operation.query),
        }
      }

      return this.client.subscribe<ApolloLink.Result>(request, {
        next: sink.next.bind(sink),
        complete: sink.complete.bind(sink),
        error: sink.error.bind(sink),
      })
    })
  }
}

export { SSELink, isSubscription, isLiveQuery }
