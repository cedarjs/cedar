import path from 'path'

import fastifyMultipart from '@fastify/multipart'
import {
  vi,
  beforeAll,
  afterAll,
  describe,
  afterEach,
  it,
  expect,
} from 'vitest'

import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type * as GraphqlServerModule from '@cedarjs/graphql-server'
import type { GraphQLYogaOptions } from '@cedarjs/graphql-server'

import { createFastifyInstance } from '../fastify.js'
import {
  cedarFastifyGraphQLServer,
  isClientDisconnectError,
} from '../plugins/graphql.js'

// Delegates to the real implementation by default, so existing tests are
// unaffected. Individual tests override the resolved value with
// `mockResolvedValueOnce` to control what `yoga.handle` does without needing
// a real GraphQL schema.
vi.mock('@cedarjs/graphql-server', async (importOriginal) => {
  const actual = await importOriginal<typeof GraphqlServerModule>()

  return {
    ...actual,
    createGraphQLYoga: vi.fn(actual.createGraphQLYoga),
  }
})

// Test double: `cedarFastifyGraphQLServer` only reads `yoga.graphqlEndpoint`
// and calls `yoga.handle`, so that's all this fake needs to implement. Safe
// because it's only ever passed to the mocked `createGraphQLYoga` above.
function fakeYogaResult(handle: () => Promise<Response>) {
  return {
    yoga: { graphqlEndpoint: '/graphql', handle },
  } as Awaited<ReturnType<typeof createGraphQLYoga>>
}

// createGraphQLYoga is mocked in these tests, so its input is never actually
// read — only used to satisfy cedarFastifyGraphQLServer's option type and
// skip the fixture-based `dist/functions/graphql.js` lookup, which has no
// `__cedar_graphqlOptions` export.
const fakeGraphqlOptions = {} as GraphQLYogaOptions

// Set up CEDAR_CWD.
let original_CEDAR_CWD: string | undefined

beforeAll(async () => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.join(__dirname, './fixtures/graphql/cedar-app')
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

describe('CedarFastifyGraphqlServer Fastify Plugin', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    vi.mocked(console.log).mockRestore()
    vi.mocked(console.warn).mockRestore()
  })

  it('registers the fastify multipart plugin to support graphql-uploads', async () => {
    const fastifyInstance = await createFastifyInstance()

    const registerSpy = vi.spyOn(fastifyInstance, 'register')

    // Although this is not how you normally register a plugin, we're going to
    // doing it this way gives us the ability to spy on the register method
    await cedarFastifyGraphQLServer(fastifyInstance, {
      cedar: {},
    })

    expect(registerSpy).toHaveBeenCalledWith(fastifyMultipart)

    await fastifyInstance.close()
  })
})

describe('isClientDisconnectError', () => {
  it('returns true for ERR_STREAM_PREMATURE_CLOSE errors', () => {
    const e = new Error('premature close')
    Object.assign(e, { code: 'ERR_STREAM_PREMATURE_CLOSE' })

    expect(isClientDisconnectError(e)).toBe(true)
  })

  it('returns true for AbortError DOMExceptions', () => {
    const e = new DOMException('This operation was aborted', 'AbortError')

    expect(isClientDisconnectError(e)).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isClientDisconnectError(new Error('boom'))).toBe(false)
  })

  it('returns false for a plain Error renamed to AbortError', () => {
    const e = Object.assign(new Error('boom'), { name: 'AbortError' })

    expect(isClientDisconnectError(e)).toBe(false)
  })

  it('returns false for non-object values', () => {
    expect(isClientDisconnectError('boom')).toBe(false)
    expect(isClientDisconnectError(null)).toBe(false)
    expect(isClientDisconnectError(undefined)).toBe(false)
  })
})

describe('GraphQL route handler client-disconnect handling', () => {
  // Tracked so `afterEach` can always close it, even if registration,
  // injection, or an assertion throws partway through a test.
  let fastifyInstance: Awaited<ReturnType<typeof createFastifyInstance>>

  afterEach(async () => {
    vi.mocked(createGraphQLYoga).mockClear()
    await fastifyInstance?.close()
  })

  it('responds 499 when yoga.handle throws a recognized disconnect error', async () => {
    fastifyInstance = await createFastifyInstance()

    vi.mocked(createGraphQLYoga).mockResolvedValueOnce(
      fakeYogaResult(() =>
        Promise.reject(
          new DOMException('This operation was aborted', 'AbortError'),
        ),
      ),
    )

    await fastifyInstance.register(cedarFastifyGraphQLServer, {
      cedar: { graphql: fakeGraphqlOptions },
    })
    await fastifyInstance.ready()

    const response = await fastifyInstance.inject({
      method: 'GET',
      url: '/graphql',
    })

    expect(response.statusCode).toBe(499)
  })

  it('keeps the normal failure path (500) for unrelated errors', async () => {
    fastifyInstance = await createFastifyInstance()

    vi.mocked(createGraphQLYoga).mockResolvedValueOnce(
      fakeYogaResult(() => Promise.reject(new Error('boom'))),
    )

    await fastifyInstance.register(cedarFastifyGraphQLServer, {
      cedar: { graphql: fakeGraphqlOptions },
    })
    await fastifyInstance.ready()

    const response = await fastifyInstance.inject({
      method: 'GET',
      url: '/graphql',
    })

    expect(response.statusCode).toBe(500)
  })
})

// Regression test for https://github.com/cedarjs/cedar/issues/2304
//
// `cedarFastifyAPI` and `cedarFastifyGraphQLServer` are registered as
// *sibling* plugins (see `createServer.ts`), each getting its own Fastify
// encapsulation context. A hook/plugin registered *inside* one of them
// (e.g. by running the user's `configureApiServer` callback inside
// `cedarFastifyAPI`) would never apply to the other sibling's routes. This
// bit real users using `configureApiServer` to register `@fastify/compress`:
// it compressed function responses, but not GraphQL responses.
//
// `createServer.ts` now runs `configureApiServer` directly on the root
// server instance, *before* registering either plugin, so hooks it adds
// apply to both. This test verifies this by passing a `configureApiServer`
// callback to `createServer` that adds an `onSend` hook, then asserting
// it applies to both a function route (served by `cedarFastifyAPI`) and
// the GraphQL route (served by `cedarFastifyGraphQLServer`).
describe('root-level hooks apply across sibling plugins (issue #2304)', () => {
  let server: Awaited<ReturnType<typeof createServer>>

  afterEach(async () => {
    vi.mocked(createGraphQLYoga).mockClear()
    await server?.close()
  })

  it('a header set by an onSend hook in configureApiServer is present on both api-function and GraphQL responses', async () => {
    // Import createServer locally to avoid affecting other tests' setup
    const { createServer: createServerFn } = await import('../createServer.js')

    // The fixture's graphql.js doesn't export __cedar_graphqlOptions, so
    // createServer will skip GraphQL setup. We need to mock the dynamic import
    // to provide proper options so the GraphQL plugin registers.
    vi.doMock(
      `file://${path.join(__dirname, './fixtures/graphql/cedar-app/api/dist/functions/graphql.js')}`,
      () => ({
        handler: async () => ({}),
        __cedar_graphqlOptions: fakeGraphqlOptions,
      }),
      { virtual: true },
    )

    // Mock the GraphQL Yoga creation so we get a real /graphql route without
    // needing a full GraphQL schema
    vi.mocked(createGraphQLYoga).mockResolvedValue(
      fakeYogaResult(() => Promise.resolve(new Response('{}'))),
    )

    // Create the server with a configureApiServer callback that adds a header.
    // This is what real users do, e.g. `server.register(compress)`.
    server = await createServerFn({
      configureApiServer: async (fastifyServer) => {
        fastifyServer.addHook('onSend', (_req, reply, payload, done) => {
          reply.header('x-configure-api-server', 'applied')
          done(null, payload)
        })
      },
    })

    // The header should be present on function routes
    const helloResponse = await server.inject({
      method: 'GET',
      url: '/hello',
    })
    expect(helloResponse.headers['x-configure-api-server']).toEqual('applied')

    // And on GraphQL routes
    const graphqlResponse = await server.inject({
      method: 'GET',
      url: '/graphql',
    })
    expect(graphqlResponse.headers['x-configure-api-server']).toEqual('applied')
  })
})
