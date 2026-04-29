import type { APIGatewayProxyEvent, Context } from 'aws-lambda'
import { vi, describe, expect, it } from 'vitest'

import { createLogger } from '@cedarjs/api/logger'

import * as yogaFactoryModule from '../../createGraphQLYoga.js'
import { createGraphQLHandler } from '../../functions/graphql.js'

interface MockLambdaParams {
  headers?: { [key: string]: string }
  body?: string | null
  httpMethod: string
  [key: string]: any
}

const mockLambdaEvent = ({
  headers,
  body = null,
  httpMethod,
  ...others
}: MockLambdaParams): APIGatewayProxyEvent => {
  return {
    headers: headers || {},
    body,
    httpMethod,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    path: '/graphql',
    pathParameters: null,
    stageVariables: null,
    queryStringParameters: null,
    requestContext: null as any,
    resource: null as any,
    ...others,
  }
}

describe('createGraphQLHandler caching', () => {
  it('only initializes yoga once across multiple invocations', async () => {
    const createGraphQLYoga = vi.spyOn(yogaFactoryModule, 'createGraphQLYoga')

    const handler = createGraphQLHandler({
      loggerConfig: { logger: createLogger({}), options: {} },
      sdls: {},
      directives: {},
      services: {},
      onException: () => {},
    })

    const mockedEvent = mockLambdaEvent({
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/graphql',
      httpMethod: 'GET',
    })

    // Even when calling the handler twice createGraphQLYoga() should only be
    // called once
    await handler(mockedEvent, {} as Context)
    await handler(mockedEvent, {} as Context)

    expect(createGraphQLYoga).toHaveBeenCalledTimes(1)
  })
})
