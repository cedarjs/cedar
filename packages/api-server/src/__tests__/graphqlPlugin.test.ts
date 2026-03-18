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
import { redwoodFastifyGraphQLServer } from '../plugins/graphql.js'

// Set up CEDAR_CWD.
let original_CEDAR_CWD: string | undefined

beforeAll(async () => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.join(__dirname, './fixtures/graphql/cedar-app')
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

describe('RedwoodFastifyGraphqlServer Fastify Plugin', () => {
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
    await redwoodFastifyGraphQLServer(fastifyInstance, {
      redwood: {},
    })

    expect(registerSpy).toHaveBeenCalledWith(fastifyMultipart)

    await fastifyInstance.close()
  })
})
