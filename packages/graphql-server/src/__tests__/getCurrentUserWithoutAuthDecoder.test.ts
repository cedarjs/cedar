import type { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { describe, expect, it, vi } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import { createGraphQLYoga } from '../createGraphQLYoga.js'
import { createGraphQLHandler } from '../functions/graphql.js'
import type { GetCurrentUser } from '../types.js'

/**
 * Regression tests for https://github.com/cedarjs/cedar/issues/2592
 *
 * A project whose auth provider hands out opaque tokens has nothing to decode
 * locally, so it configures `getCurrentUser` without an `authDecoder` and
 * validates the raw token itself. Every entry point has to call
 * `getCurrentUser` for such a project, with `null` as the decoded value and
 * the raw token alongside it.
 */

const CURRENT_USER_QUERY = 'query CurrentUser { cedar { currentUser } }'

const AUTH_HEADERS = {
  'auth-provider': 'custom-auth',
  authorization: 'Bearer opaque-token',
}

const getCurrentUser: GetCurrentUser = vi.fn(
  async (decoded, { token, type }) => {
    if (type !== 'custom-auth') {
      return null
    }

    return { id: 'user-1', token, decoded }
  },
)

const yogaOptions = {
  loggerConfig: { logger: createLogger({}), options: {} },
  sdls: {},
  services: {},
  getCurrentUser,
}

describe('getCurrentUser without an authDecoder', () => {
  it('is called on the fetch-native path, with the raw token', async () => {
    const { yoga, buildRequestContext } = await createGraphQLYoga(yogaOptions)

    // The global `Request` is what the Fastify, dev and universal-deploy
    // entry points hand `yoga.handle`. Its body can only be read once, which
    // is why the context has to be built first.
    const request = new globalThis.Request('http://localhost:8911/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ query: CURRENT_USER_QUERY }),
    })

    const cedarContext = await buildRequestContext(request)
    const response = await yoga.handle(request, { request, cedarContext })

    expect(getCurrentUser).toHaveBeenCalledWith(
      null,
      { type: 'custom-auth', schema: 'Bearer', token: 'opaque-token' },
      expect.objectContaining({ request }),
    )

    const body = await response.json()

    expect(body.data).toEqual({
      cedar: {
        currentUser: { id: 'user-1', token: 'opaque-token', decoded: null },
      },
    })
  })

  it('is called on the serverless path, with the raw token', async () => {
    const handler = createGraphQLHandler(yogaOptions)

    const event: APIGatewayProxyEvent = {
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ query: CURRENT_USER_QUERY }),
      httpMethod: 'POST',
      multiValueQueryStringParameters: null,
      isBase64Encoded: false,
      multiValueHeaders: {},
      path: '/graphql',
      pathParameters: null,
      stageVariables: null,
      queryStringParameters: null,
      // Only the fields above are read on this path
      requestContext: null as unknown as APIGatewayProxyEvent['requestContext'],
      resource: '/graphql',
    }

    const response = await handler(event, {} as Context)

    expect(getCurrentUser).toHaveBeenCalledWith(
      null,
      { type: 'custom-auth', schema: 'Bearer', token: 'opaque-token' },
      expect.objectContaining({ event }),
    )

    const body = JSON.parse(response.body)

    expect(body.data).toEqual({
      cedar: {
        currentUser: { id: 'user-1', token: 'opaque-token', decoded: null },
      },
    })
  })
})
