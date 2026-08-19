import { createSchema, createYoga } from 'graphql-yoga'
import { afterEach, describe, expect, it } from 'vitest'

import { useCedarTrustedDocuments } from '../useCedarTrustedDocuments.js'

const HELLO_QUERY = 'query Hello { hello }'
const HELLO_SHA = 'ba5eba11ba5eba11ba5eba11ba5eba11ba5eba11'

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Cedar {
      currentUser: String
    }

    type Query {
      hello: String!
      cedar: Cedar!
    }

    type Mutation {
      resyncMailRenderers: Boolean!
    }
  `,
  resolvers: {
    Query: {
      hello: () => 'world',
      cedar: () => ({ currentUser: null }),
    },
    Mutation: {
      resyncMailRenderers: () => true,
    },
  },
})

/**
 * `@cedarjs/api-server` builds the incoming Request with the *global* `Request`
 * (native undici on Node >= 18) and hands it to `yoga.handle()`. A native
 * Request body can only be read once, and Yoga has already read it to build the
 * GraphQL params by the time plugins run — so plugins must never read it again.
 *
 * `yoga.fetch()` does not exercise this: it goes through Yoga's
 * `@whatwg-node/node-fetch` ponyfill, whose Request happily re-reads a string
 * body. Use the native Request here so the tests cover what a real app does.
 */
const handle = (
  yogaInstance: ReturnType<typeof createYoga>,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  yogaInstance.handle(
    new globalThis.Request('http://cedar.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    {},
  )

const yoga = createYoga({
  schema,
  plugins: [useCedarTrustedDocuments({ store: { [HELLO_SHA]: HELLO_QUERY } })],
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handle(yoga, body, headers)

const curNodeEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = curNodeEnv
})

describe('useCedarTrustedDocuments', () => {
  it('executes an operation that is in the store', async () => {
    const response = await post({
      extensions: { persistedQuery: { version: 1, sha256Hash: HELLO_SHA } },
    })

    expect(await response.json()).toEqual({ data: { hello: 'world' } })
  })

  it('rejects an operation that is not in the store', async () => {
    const response = await post({
      extensions: {
        persistedQuery: { version: 1, sha256Hash: 'not-in-the-store' },
      },
    })

    const body = await response.json()
    expect(body.errors[0].message).toBe('PersistedQueryNotFound')
  })

  it('rejects an arbitrary operation with the Cedar error', async () => {
    const response = await post({ query: '{ hello }' })

    // Pin the exact error contract the auth flow depends on: the custom
    // `persistedQueryOnly` error must reach the client unmasked, not as a
    // masked internal server error. Cedar configures it as a plain string, so
    // the plugin creates the GraphQLError without any `extensions.code`.
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].message).toBe('Use Trusted Only!')
    expect(body.errors[0].extensions).toBeUndefined()
  })

  it('allows the Cedar Auth getCurrentUser query', async () => {
    const response = await post(
      {
        query: 'query __CEDAR__AUTH_GET_CURRENT_USER { cedar { currentUser } }',
      },
      { 'auth-provider': 'dbAuth', authorization: 'Bearer mock-token' },
    )

    expect(await response.json()).toEqual({
      data: { cedar: { currentUser: null } },
    })
  })

  it('rejects the getCurrentUser query without the auth headers', async () => {
    const response = await post({
      query: 'query __CEDAR__AUTH_GET_CURRENT_USER { cedar { currentUser } }',
    })

    const body = await response.json()
    expect(body.errors[0].message).toBe('Use Trusted Only!')
  })

  it('allows the Studio resync mutation in development', async () => {
    process.env.NODE_ENV = 'development'

    const response = await post({ query: 'mutation { resyncMailRenderers }' })

    expect(await response.json()).toEqual({
      data: { resyncMailRenderers: true },
    })
  })

  it('rejects the Studio resync mutation outside development', async () => {
    process.env.NODE_ENV = 'production'

    const response = await post({ query: 'mutation { resyncMailRenderers }' })

    const body = await response.json()
    expect(body.errors[0].message).toBe('Use Trusted Only!')
  })

  it('still honours a user-supplied allowArbitraryOperations', async () => {
    const permissive = createYoga({
      schema,
      plugins: [
        useCedarTrustedDocuments({
          store: { [HELLO_SHA]: HELLO_QUERY },
          allowArbitraryOperations: true,
        }),
      ],
    })

    const response = await handle(permissive, { query: '{ hello }' })

    expect(await response.json()).toEqual({ data: { hello: 'world' } })
  })
})
