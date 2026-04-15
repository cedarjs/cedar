import type { APIGatewayProxyResult } from 'aws-lambda'
import { describe, expect, it, vi } from 'vitest'

import {
  buildCedarContext,
  composeCedarMiddleware,
  legacyResultToResponse,
  requestToLegacyEvent,
  routeManifestToJSON,
  wrapLegacyHandler,
} from '../runtime.js'
import type {
  CedarHandler,
  CedarMiddleware,
  CedarRouteRecord,
} from '../runtime.js'

describe('buildCedarContext', () => {
  it('builds params, query, and cookies from a Request', async () => {
    const request = new Request(
      'http://localhost:8911/graphql?hello=world&its=bugs',
      {
        headers: {
          cookie: 'session=abc123; theme=dark',
        },
      },
    )

    const ctx = await buildCedarContext(request, {
      params: {
        id: '42',
      },
    })

    expect(ctx.params).toEqual({ id: '42' })

    expect(ctx.query.get('hello')).toBe('world')
    expect(ctx.query.get('its')).toBe('bugs')

    expect(ctx.cookies).toEqual({
      session: 'abc123',
      theme: 'dark',
    })

    expect(ctx.serverAuthState).toBeUndefined()
  })

  it('returns an empty query when there is no query string', async () => {
    const request = new Request('http://localhost:8911/graphql')

    const ctx = await buildCedarContext(request)

    expect(ctx.query.size).toBe(0)
  })

  it('supports multi-value params via getAll', async () => {
    const request = new Request(
      'http://localhost:8911/api?tag=cedar&tag=framework',
    )

    const ctx = await buildCedarContext(request)

    expect(ctx.query.getAll('tag')).toEqual(['cedar', 'framework'])
  })

  it('hydrates auth state when an auth decoder is provided', async () => {
    const authDecoder = vi.fn(async (token: string, type: string) => {
      expect(token).toBe('auth-provider=test; session=token-123')
      expect(type).toBe('test')

      return {
        sub: 'user-1',
      }
    })

    const request = new Request('http://localhost:8911/graphql', {
      headers: {
        cookie: 'auth-provider=test; session=token-123',
      },
    })

    const ctx = await buildCedarContext(request, {
      authDecoder,
    })

    expect(authDecoder).toHaveBeenCalledTimes(1)
    expect(ctx.serverAuthState).toEqual([
      {
        sub: 'user-1',
      },
      {
        type: 'test',
        schema: 'cookie',
        token: 'auth-provider=test; session=token-123',
      },
      {
        event: request,
        context: undefined,
      },
    ])
  })
})

describe('composeCedarMiddleware', () => {
  it('composes middleware around a handler in order', async () => {
    const calls: string[] = []

    const handler: CedarHandler = async (_request, ctx) => {
      calls.push(`handler:${ctx.params.id}`)

      return new Response('ok', {
        status: 201,
        headers: {
          'x-handler': 'true',
        },
      })
    }

    const middlewareOne: CedarMiddleware = async (request, ctx, next) => {
      calls.push('mw1:before')
      const response = await next(request, {
        ...ctx,
        params: {
          ...ctx.params,
          id: `${ctx.params.id}-one`,
        },
      })
      calls.push('mw1:after')
      response.headers.set('x-mw1', 'true')

      return response
    }

    const middlewareTwo: CedarMiddleware = async (request, ctx, next) => {
      calls.push('mw2:before')
      const response = await next(request, {
        ...ctx,
        params: {
          ...ctx.params,
          id: `${ctx.params.id}-two`,
        },
      })
      calls.push('mw2:after')
      response.headers.set('x-mw2', 'true')

      return response
    }

    const composed = composeCedarMiddleware(handler, [
      middlewareOne,
      middlewareTwo,
    ])

    const response = await composed(new Request('http://localhost/hello'), {
      params: {
        id: 'base',
      },
      query: new URLSearchParams(),
      cookies: {},
      serverAuthState: undefined,
    })

    expect(calls).toEqual([
      'mw1:before',
      'mw2:before',
      'handler:base-one-two',
      'mw2:after',
      'mw1:after',
    ])
    expect(response.status).toBe(201)
    expect(response.headers.get('x-handler')).toBe('true')
    expect(response.headers.get('x-mw1')).toBe('true')
    expect(response.headers.get('x-mw2')).toBe('true')
    expect(await response.text()).toBe('ok')
  })
})

describe('requestToLegacyEvent', () => {
  it('converts a Request and Cedar context into a lambda-style event', async () => {
    const request = new Request(
      'http://localhost:8911/functions/hello?greeting=hi&greeting=hello&name=cedar',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'session=abc123',
        },
        body: JSON.stringify({
          ok: true,
        }),
      },
    )

    const event = await requestToLegacyEvent(request, {
      params: {
        routeName: 'hello',
      },
      query: new URLSearchParams('greeting=hi&greeting=hello&name=cedar'),
      cookies: {
        session: 'abc123',
      },
      serverAuthState: undefined,
    })

    expect(event.httpMethod).toBe('POST')
    expect(event.path).toBe('/functions/hello')
    expect(event.body).toBe(JSON.stringify({ ok: true }))
    expect(event.headers['content-type']).toBe('application/json')
    expect(event.pathParameters).toEqual({
      routeName: 'hello',
    })
    expect(event.queryStringParameters).toEqual({
      greeting: ['hi', 'hello'],
      name: 'cedar',
    })
    expect(event.multiValueQueryStringParameters).toEqual({
      greeting: ['hi', 'hello'],
      name: ['cedar'],
    })
  })
})

describe('legacyResultToResponse', () => {
  it('converts a lambda result into a Response', async () => {
    const result: APIGatewayProxyResult = {
      statusCode: 202,
      headers: {
        'content-type': 'application/json',
      },
      multiValueHeaders: {
        'set-cookie': ['a=1', 'b=2'],
      },
      body: JSON.stringify({
        ok: true,
      }),
    }

    const response = legacyResultToResponse(result)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('set-cookie')).toContain('a=1')
    expect(response.headers.get('set-cookie')).toContain('b=2')
    expect(await response.text()).toBe(JSON.stringify({ ok: true }))
  })

  it('returns a Response unchanged when given one', async () => {
    const response = new Response('hello', {
      status: 200,
      headers: {
        'x-test': 'true',
      },
    })

    const result = legacyResultToResponse(response)

    expect(result).toBe(response)
    expect(result.status).toBe(200)
    expect(result.headers.get('x-test')).toBe('true')
  })
})

describe('wrapLegacyHandler', () => {
  it('wraps a legacy handler in the Cedar handler contract', async () => {
    const legacyHandler = vi.fn(async (event) => {
      expect(event.httpMethod).toBe('POST')
      expect(event.path).toBe('/hello')
      expect(event.queryStringParameters).toEqual({
        name: 'cedar',
      })

      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          data: 'wrapped',
        }),
      }
    })

    const response = await wrapLegacyHandler(legacyHandler)(
      new Request('http://localhost/hello?name=cedar', {
        method: 'POST',
        body: JSON.stringify({
          ok: true,
        }),
      }),
      {
        params: {},
        query: new URLSearchParams('name=cedar'),
        cookies: {},
        serverAuthState: undefined,
      },
    )

    expect(legacyHandler).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({
      data: 'wrapped',
    })
  })
})

describe('routeManifestToJSON', () => {
  it('serializes route records as pretty-printed JSON', () => {
    const routes: CedarRouteRecord[] = [
      {
        path: '/graphql',
        methods: ['GET', 'POST'],
        type: 'graphql',
        entry: 'api/dist/functions/graphql.js',
      },
      {
        path: '/health',
        methods: ['GET'],
        type: 'health',
        entry: 'api/dist/functions/health.js',
      },
    ]

    expect(routeManifestToJSON(routes)).toBe(`[
  {
    "path": "/graphql",
    "methods": [
      "GET",
      "POST"
    ],
    "type": "graphql",
    "entry": "api/dist/functions/graphql.js"
  },
  {
    "path": "/health",
    "methods": [
      "GET"
    ],
    "type": "health",
    "entry": "api/dist/functions/health.js"
  }
]`)
  })
})
