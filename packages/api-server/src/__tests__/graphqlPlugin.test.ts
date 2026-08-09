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

import { createFastifyInstance } from '../fastify.js'
import {
  cedarFastifyGraphQLServer,
  isClientDisconnectError,
} from '../plugins/graphql.js'

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

  it('returns false for non-object values', () => {
    expect(isClientDisconnectError('boom')).toBe(false)
    expect(isClientDisconnectError(null)).toBe(false)
    expect(isClientDisconnectError(undefined)).toBe(false)
  })
})
