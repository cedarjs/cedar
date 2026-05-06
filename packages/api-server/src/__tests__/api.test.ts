import path from 'path'

import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest'

import { createFastifyInstance } from '../fastify.js'
import { cedarFastifyAPI } from '../plugins/api.js'
import { getCedarRouteManifest } from '../plugins/lambdaLoader.js'

// Suppress terminal logging.
console.log = vi.fn()
console.warn = vi.fn()

let original_CEDAR_CWD: string | undefined

// Set up and teardown the fastify instance for each test.
let fastifyInstance: Awaited<ReturnType<typeof createFastifyInstance>>

beforeAll(async () => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.resolve(__dirname, 'fixtures/graphql/cedar-app')

  fastifyInstance = await createFastifyInstance()

  fastifyInstance.register(cedarFastifyAPI, {
    redwood: {
      loadUserConfig: true,
    },
  })

  await fastifyInstance.ready()
})

afterAll(async () => {
  await fastifyInstance.close()

  if (original_CEDAR_CWD === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = original_CEDAR_CWD
  }
})

describe('cedarFastifyAPI', () => {
  it('configures the `@fastify/url-data` and `fastify-raw-body` plugins', () => {
    const plugins = fastifyInstance.printPlugins()

    expect(plugins.includes('@fastify/url-data')).toEqual(true)
    expect(plugins.includes('fastify-raw-body')).toEqual(true)
  })

  it('can be configured by the user', async () => {
    const res = await fastifyInstance.inject({
      method: 'GET',
      url: '/rest/v1/users/get/1',
    })

    expect(res.body).toEqual(JSON.stringify({ id: 1 }))
  })

  // We use `fastify.all` to register functions, which means they're invoked for all HTTP verbs.
  // Only testing GET and POST here at the moment.
  //
  // We can use `printRoutes` with a method for debugging, but not without one.
  // See https://fastify.dev/docs/latest/Reference/Server#printroutes
  it('builds a tree of routes for GET and POST', () => {
    expect(fastifyInstance.printRoutes({ method: 'GET' }))
      .toMatchInlineSnapshot(`
      "└── /
          ├── rest/v1/users/get/
          │   └── :userId (GET)
          └── :routeName (GET)
              └── /
                  └── * (GET)
      "
    `)

    expect(fastifyInstance.printRoutes({ method: 'POST' }))
      .toMatchInlineSnapshot(`
      "└── /
          └── :routeName (POST)
              └── /
                  └── * (POST)
      "
    `)
  })

  describe('serves functions', () => {
    it('serves hello.js', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/hello',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({ data: 'hello function' })
    })

    it('it serves graphql.js', async () => {
      const res = await fastifyInstance.inject({
        method: 'POST',
        url: '/graphql?query={redwood{version}}',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({ data: { version: 42 } })
    })

    it('serves health.js', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/health',
      })

      expect(res.statusCode).toEqual(200)
    })

    it('serves a nested function, nested.js', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/nested/nested',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({ data: 'nested function' })
    })

    it("doesn't serve deeply-nested functions", async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/deeplyNested/nestedDir/deeplyNested',
      })

      expect(res.statusCode).toEqual(404)
      expect(res.body).toEqual(
        'Function &quot;deeplyNested&quot; was not found.',
      )
    })

    describe('route manifest', () => {
      it('records provider-relevant backend routes', () => {
        expect(getCedarRouteManifest()).toEqual(
          expect.arrayContaining([
            {
              id: '/graphql',
              path: '/graphql',
              methods: ['GET', 'POST', 'OPTIONS'],
              type: 'graphql',
              entry: expect.stringContaining('/api/dist/functions/graphql.js'),
            },
            {
              id: '/health',
              path: '/health',
              methods: ['GET', 'POST'],
              type: 'health',
              entry: expect.stringContaining('/api/dist/functions/health.js'),
            },
            {
              id: '/hello',
              path: '/hello',
              methods: ['GET', 'POST'],
              type: 'function',
              entry: expect.stringContaining('/api/dist/functions/hello.js'),
            },
            {
              id: '/env',
              path: '/env',
              methods: ['GET', 'POST'],
              type: 'function',
              entry: expect.stringContaining('/api/dist/functions/env.js'),
            },
            {
              id: '/another-graphql',
              path: '/another-graphql',
              methods: ['GET', 'POST'],
              type: 'function',
              entry: expect.stringContaining(
                '/api/dist/functions/another-graphql.js',
              ),
            },
            {
              id: '/nested',
              path: '/nested',
              methods: ['GET', 'POST'],
              type: 'function',
              entry: expect.stringContaining(
                '/api/dist/functions/nested/nested.js',
              ),
            },
            {
              id: '/noHandler',
              path: '/noHandler',
              methods: ['GET', 'POST'],
              type: 'function',
              entry: expect.stringContaining(
                '/api/dist/functions/noHandler.js',
              ),
            },
          ]),
        )
        expect(getCedarRouteManifest()).toHaveLength(7)
      })
    })
  })
})
