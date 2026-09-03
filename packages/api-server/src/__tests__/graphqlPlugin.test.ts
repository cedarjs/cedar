import path from 'path'
import { gunzipSync } from 'zlib'

import fastifyCompress from '@fastify/compress'
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

import { buildCedarContext } from '@cedarjs/api/runtime'
import { createGraphQLYoga } from '@cedarjs/graphql-server'
import type * as GraphqlServerModule from '@cedarjs/graphql-server'
import type {
  CedarGraphQLServer,
  GraphQLYogaOptions,
} from '@cedarjs/graphql-server'

import type { createServer } from '../createServer.js'
import type { CreateServerOptions } from '../createServerHelpers.js'
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

// Test double: `cedarFastifyGraphQLServer` only reads `yoga.graphqlEndpoint`,
// calls `yoga.handle`, and builds the context to hand it with
// `buildRequestContext`, so that's all this fake needs to implement. Safe
// because it's only ever passed to the mocked `createGraphQLYoga` above.
function fakeYogaResult(handle: () => Promise<Response>) {
  return {
    yoga: { graphqlEndpoint: '/graphql', handle },
    buildRequestContext: (request: Request) => buildCedarContext(request),
  } as CedarGraphQLServer
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

// Regression tests for https://github.com/cedarjs/cedar/issues/2304
//
// `cedarFastifyAPI` and `cedarFastifyGraphQLServer` are registered as
// *sibling* plugins (see `createServer.ts`), each getting its own Fastify
// encapsulation context. A hook/plugin registered *inside* one of them
// (e.g. via `configureApiServer`, which runs inside `cedarFastifyAPI`, or
// `configureGraphQLServer`, which runs inside `cedarFastifyGraphQLServer`)
// only applies to that plugin's own routes, never the sibling's. This is
// intentional: the two are configured independently on purpose (see PR
// review discussion on #2389).
//
// Real users hit #2304 by registering `@fastify/compress` via
// `configureApiServer`, expecting it to also compress GraphQL responses.
//
// Applying a plugin/hook to *both* function and GraphQL routes has two
// supported options, depending on what the plugin does:
//
// - Plain request-lifecycle hooks (`onRequest`, `onSend`, etc.) can be
//   registered directly on the `server` instance returned by
//   `createServer()`. That works because Fastify resolves hooks added to a
//   parent context against its children's routes at request-dispatch time,
//   regardless of whether they were added before or after the children were
//   registered.
// - Plugins with a "global" mode that works by hooking Fastify's `onRoute`
//   (e.g. `@fastify/compress`) are different: `onRoute` only fires for
//   routes registered *after* the plugin itself, so registering them on the
//   returned `server` (i.e. after `cedarFastifyAPI`/
//   `cedarFastifyGraphQLServer` already registered their routes) silently
//   does nothing. These must be registered via the new `configureServer`
//   option, which runs *before* any routes exist.
describe('configureApiServer / configureGraphQLServer scoping (issue #2304)', () => {
  let server: Awaited<ReturnType<typeof createServer>>

  async function createServerWithGraphQL(
    options: CreateServerOptions,
    yogaHandle: () => Promise<Response> = () =>
      Promise.resolve(new Response('{}')),
  ) {
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
    // needing a full GraphQL schema. Defaults to a small `{}` response, but
    // callers (e.g. the compression test below) can override the body.
    vi.mocked(createGraphQLYoga).mockResolvedValue(fakeYogaResult(yogaHandle))

    return createServerFn(options)
  }

  afterEach(async () => {
    vi.mocked(createGraphQLYoga).mockClear()
    await server?.close()
  })

  it('configureApiServer only applies to api-function routes, not GraphQL', async () => {
    server = await createServerWithGraphQL({
      configureApiServer: async (fastifyServer) => {
        fastifyServer.addHook('onSend', (_req, reply, payload, done) => {
          reply.header('x-configure-api-server', 'applied')
          done(null, payload)
        })
      },
    })

    const helloResponse = await server.inject({ method: 'GET', url: '/hello' })
    expect(helloResponse.headers['x-configure-api-server']).toEqual('applied')

    const graphqlResponse = await server.inject({
      method: 'GET',
      url: '/graphql',
    })
    expect(graphqlResponse.headers['x-configure-api-server']).toBeUndefined()
  })

  it('configureGraphQLServer only applies to GraphQL routes, not api-functions', async () => {
    server = await createServerWithGraphQL({
      configureGraphQLServer: async (fastifyServer) => {
        fastifyServer.addHook('onSend', (_req, reply, payload, done) => {
          reply.header('x-configure-graphql-server', 'applied')
          done(null, payload)
        })
      },
    })

    const graphqlResponse = await server.inject({
      method: 'GET',
      url: '/graphql',
    })
    expect(graphqlResponse.headers['x-configure-graphql-server']).toEqual(
      'applied',
    )

    const helloResponse = await server.inject({ method: 'GET', url: '/hello' })
    expect(helloResponse.headers['x-configure-graphql-server']).toBeUndefined()
  })

  it('registering a plugin directly on the returned server applies to both', async () => {
    server = await createServerWithGraphQL({})

    server.addHook('onSend', (_req, reply, payload, done) => {
      reply.header('x-root-hook', 'applied')
      done(null, payload)
    })
    await server.ready()

    const helloResponse = await server.inject({ method: 'GET', url: '/hello' })
    expect(helloResponse.headers['x-root-hook']).toEqual('applied')

    const graphqlResponse = await server.inject({
      method: 'GET',
      url: '/graphql',
    })
    expect(graphqlResponse.headers['x-root-hook']).toEqual('applied')
  })

  it('registering @fastify/compress via configureServer actually compresses both api-function and GraphQL responses', async () => {
    // Use a real (non-mocked) yoga.handle response with a body large enough
    // that @fastify/compress's default threshold (1024 bytes) kicks in, so
    // this exercises real gzip compression end to end rather than just
    // asserting a header was set.
    const largeJsonBody = JSON.stringify({
      data: 'x'.repeat(2000),
    })

    server = await createServerWithGraphQL(
      {
        // `configureServer` runs before `cedarFastifyAPI`/
        // `cedarFastifyGraphQLServer` register their routes, which is
        // required for `@fastify/compress`'s `onRoute`-based global hook to
        // catch them. `threshold: 0` forces compression regardless of
        // payload size, so the tiny `/hello` fixture response (well under
        // the default 1024-byte threshold) is compressed too, not just the
        // larger GraphQL response.
        configureServer: async (fastifyServer) => {
          await fastifyServer.register(fastifyCompress, {
            global: true,
            threshold: 0,
          })
        },
      },
      () =>
        Promise.resolve(
          new Response(largeJsonBody, {
            headers: { 'content-type': 'application/json' },
          }),
        ),
    )

    const helloResponse = await server.inject({
      method: 'GET',
      url: '/hello',
      headers: { 'accept-encoding': 'gzip' },
    })
    expect(helloResponse.headers['content-encoding']).toEqual('gzip')

    const graphqlResponse = await server.inject({
      method: 'GET',
      url: '/graphql',
      headers: { 'accept-encoding': 'gzip' },
    })
    expect(graphqlResponse.headers['content-encoding']).toEqual('gzip')

    // Confirm the compressed payload actually decompresses back to the
    // original body, i.e. this isn't just a header being set with
    // uncompressed bytes underneath.
    const decompressed = gunzipSync(graphqlResponse.rawPayload).toString(
      'utf-8',
    )
    expect(decompressed).toEqual(largeJsonBody)
  })
})
