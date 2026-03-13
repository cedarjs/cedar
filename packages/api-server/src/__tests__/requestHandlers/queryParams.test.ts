import path from 'node:path'

import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest'

import { createFastifyInstance } from '../../fastify.js'
import { redwoodFastifyAPI } from '../../plugins/api.js'

// Suppress terminal logging.
console.log = vi.fn()
console.warn = vi.fn()

// Set up CEDAR_CWD.
let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.resolve(
    __dirname,
    '../fixtures/graphql/cedar-app',
  )
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

let fastifyInstance: Awaited<ReturnType<typeof createFastifyInstance>>

beforeAll(async () => {
  fastifyInstance = await createFastifyInstance()

  fastifyInstance.register(redwoodFastifyAPI, {
    redwood: {
      loadUserConfig: true,
    },
  })

  await fastifyInstance.ready()
})

afterAll(async () => {
  await fastifyInstance.close()
})

describe('query parameter parsing via picoquery', () => {
  describe('simple (flat) parameters', () => {
    it('parses a single string parameter', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?foo=bar',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { foo: 'bar' },
      })
    })

    it('parses multiple flat parameters', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?foo=bar&baz=qux',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { foo: 'bar', baz: 'qux' },
      })
    })

    it('returns an empty object for queryStringParameters when there is no query string', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams',
      })

      expect(res.statusCode).toEqual(200)
      // picoquery returns {} (not null) when there is no query string
      expect(res.json()).toEqual({
        queryStringParameters: {},
      })
    })
  })

  describe('array parameters (bracket-repeat syntax)', () => {
    it('parses a repeated bracket key into an array', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?ids[]=1&ids[]=2&ids[]=3',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { ids: ['1', '2', '3'] },
      })
    })

    it('parses a single bracket key as a one-element array', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?ids[]=42',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { ids: ['42'] },
      })
    })

    it('parses mixed flat and array parameters', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?name=cedar&tags[]=framework&tags[]=api',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: {
          name: 'cedar',
          tags: ['framework', 'api'],
        },
      })
    })
  })

  describe('nested parameters (JS dot syntax)', () => {
    it('parses a single level of nesting', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?user.name=alice',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { user: { name: 'alice' } },
      })
    })

    it('parses multiple keys under the same nested object', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?user.name=alice&user.age=30',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { user: { name: 'alice', age: '30' } },
      })
    })

    it('parses deeply nested parameters', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?a.b.c=deep',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { a: { b: { c: 'deep' } } },
      })
    })

    it('parses sibling nested objects', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?filter.status=active&filter.role=admin&sort.field=name&sort.order=asc',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: {
          filter: { status: 'active', role: 'admin' },
          sort: { field: 'name', order: 'asc' },
        },
      })
    })
  })

  describe('combined nested and array parameters', () => {
    it('parses an array nested inside an object', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?filter.ids[]=1&filter.ids[]=2',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: { filter: { ids: ['1', '2'] } },
      })
    })

    it('parses a mix of flat, nested, and array parameters together', async () => {
      const res = await fastifyInstance.inject({
        method: 'GET',
        url: '/queryparams?page=1&filter.status=active&tags[]=a&tags[]=b',
      })

      expect(res.statusCode).toEqual(200)
      expect(res.json()).toEqual({
        queryStringParameters: {
          page: '1',
          filter: { status: 'active' },
          tags: ['a', 'b'],
        },
      })
    })
  })
})
