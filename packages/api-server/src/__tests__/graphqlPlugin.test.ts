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
  afterEach(async () => {
    vi.mocked(createGraphQLYoga).mockClear()
  })

  it('responds 499 when yoga.handle throws a recognized disconnect error', async () => {
    const fastifyInstance = await createFastifyInstance()

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

    await fastifyInstance.close()
  })

  it('keeps the normal failure path (500) for unrelated errors', async () => {
    const fastifyInstance = await createFastifyInstance()

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

    await fastifyInstance.close()
  })
})
