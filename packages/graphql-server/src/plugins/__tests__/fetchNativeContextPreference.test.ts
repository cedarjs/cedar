import type { APIGatewayProxyEvent } from 'aws-lambda'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthContextPayload, Decoder } from '@cedarjs/api'
import * as apiAuth from '@cedarjs/api/auth'

import { useRedwoodAuthContext } from '../useRedwoodAuthContext.js'

const authDecoder: Decoder = async (token: string) => ({ token })

vi.mock('@cedarjs/api/auth', async () => {
  return {
    getAuthenticationContext: vi.fn(),
  }
})

const MOCK_AUTH_CONTEXT: AuthContextPayload = [
  { sub: '1', email: 'ba@zin.ga' },
  {
    type: 'mocked-auth-type',
    schema: 'mocked-schema-bearer',
    token: 'mocked-undecoded-token',
  },
  { event: new Request('http://localhost/mock'), context: undefined },
]

const createMockLambdaEvent = (
  headers: Record<string, string>,
): APIGatewayProxyEvent => {
  return {
    body: null,
    headers,
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/graphql',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: 'MOCKED_ACCOUNT',
      apiId: 'MOCKED_API_ID',
      authorizer: undefined,
      protocol: 'HTTP/1.1',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: headers['user-agent'] ?? null,
        userArn: null,
      },
      path: '/graphql',
      stage: 'dev',
      requestId: 'legacy-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource-id',
      resourcePath: '/graphql',
      httpMethod: 'POST',
    },
    resource: '/graphql',
  }
}

type MockContextBuildingArgs = Parameters<
  NonNullable<ReturnType<typeof useRedwoodAuthContext>['onContextBuilding']>
>[0]

describe('fetch-native GraphQL context preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiAuth.getAuthenticationContext).mockResolvedValue(
      MOCK_AUTH_CONTEXT,
    )
  })

  describe('useRedwoodAuthContext', () => {
    it('prefers fetch-native request over legacy event', async () => {
      const request = new Request('http://localhost/graphql', {
        headers: {
          authorization: 'Bearer fetch-token',
          'auth-provider': 'test',
        },
      })

      const plugin = useRedwoodAuthContext(undefined, authDecoder)
      const onContextBuilding = plugin.onContextBuilding

      if (!onContextBuilding) {
        throw new Error('Expected onContextBuilding hook to be defined')
      }

      const extendContext = vi.fn()
      const legacyEvent = createMockLambdaEvent({
        authorization: 'Bearer legacy-token',
        'auth-provider': 'legacy',
      })

      await onContextBuilding({
        context: {
          params: {},
          request,
          event: legacyEvent,
          requestContext: undefined,
        } as MockContextBuildingArgs['context'],
        extendContext,
        breakContextBuilding() {
          return undefined
        },
      } as MockContextBuildingArgs)

      expect(apiAuth.getAuthenticationContext).toHaveBeenCalledWith({
        authDecoder,
        event: request,
        context: undefined,
      })
      expect(extendContext).not.toHaveBeenCalled()
    })

    it('falls back to legacy event when fetch-native request is absent', async () => {
      const legacyEvent = createMockLambdaEvent({
        authorization: 'Bearer legacy-token',
        'auth-provider': 'legacy',
      })

      const plugin = useRedwoodAuthContext(undefined, authDecoder)
      const onContextBuilding = plugin.onContextBuilding

      if (!onContextBuilding) {
        throw new Error('Expected onContextBuilding hook to be defined')
      }

      const extendContext = vi.fn()

      await onContextBuilding({
        context: {
          params: {},
          event: legacyEvent,
          requestContext: undefined,
        } as MockContextBuildingArgs['context'],
        extendContext,
        breakContextBuilding() {
          return undefined
        },
      } as MockContextBuildingArgs)

      expect(apiAuth.getAuthenticationContext).toHaveBeenCalledWith({
        authDecoder,
        event: legacyEvent,
        context: undefined,
      })
      expect(extendContext).not.toHaveBeenCalled()
    })
  })
})
