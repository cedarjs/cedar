import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import type { APIGatewayProxyEvent, Context as LambdaContext } from 'aws-lambda'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthContextPayload, Decoder } from '@cedarjs/api'
import * as apiAuth from '@cedarjs/api/auth'
import { createLogger } from '@cedarjs/api/logger'

import type { CedarGraphQLContext } from '../../types.js'
import { useRedwoodAuthContext } from '../useRedwoodAuthContext.js'
import type { LoggerConfig } from '../useRedwoodLogger.js'
import { useRedwoodLogger } from '../useRedwoodLogger.js'

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

const watchFileCreated = (filename: string) => {
  return new Promise<void>((resolve, reject) => {
    const TIMEOUT = 800
    const INTERVAL = 100
    const threshold = TIMEOUT / INTERVAL
    let counter = 0
    const interval = setInterval(() => {
      if (existsSync(filename) && statSync(filename).size !== 0) {
        clearInterval(interval)
        resolve()
      } else if (counter <= threshold) {
        counter++
      } else {
        clearInterval(interval)
        reject(new Error(`${filename} was not created.`))
      }
    }, INTERVAL)
  })
}

const parseLogFile = (logFile: string): Record<string, unknown>[] => {
  const contents = readFileSync(logFile).toString().trim()

  if (!contents) {
    return []
  }

  return JSON.parse(`[${contents.split(/\r\n|\n/).join(',')}]`) as Record<
    string,
    unknown
  >[]
}

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

const createMockLambdaContext = (awsRequestId: string): LambdaContext => {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'graphql',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:local:0:function:graphql',
    memoryLimitInMB: '128',
    awsRequestId,
    logGroupName: '/aws/lambda/graphql',
    logStreamName: '2026/04/14/graphql',
    getRemainingTimeInMillis() {
      return 1000
    },
    done() {
      return undefined
    },
    fail() {
      return undefined
    },
    succeed() {
      return undefined
    },
  }
}

type MockContextBuildingArgs = Parameters<
  NonNullable<ReturnType<typeof useRedwoodAuthContext>['onContextBuilding']>
>[0]

type MockOnExecuteArgs = Parameters<
  NonNullable<ReturnType<typeof useRedwoodLogger>['onExecute']>
>[0]

type MockOnExecuteResult = Exclude<
  Awaited<
    ReturnType<NonNullable<ReturnType<typeof useRedwoodLogger>['onExecute']>>
  >,
  void
>

type MockOnExecuteDonePayload = Parameters<
  NonNullable<MockOnExecuteResult['onExecuteDone']>
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

  describe('useRedwoodLogger', () => {
    it('prefers fetch-native request metadata over legacy event metadata', async () => {
      const logFile = join(
        os.tmpdir(),
        '_' + Math.random().toString(36).substring(2, 11),
      )

      const logger = createLogger({
        options: {
          level: 'trace',
        },
        destination: logFile,
      })

      const loggerConfig: LoggerConfig = {
        logger,
        options: {
          operationName: true,
          requestId: true,
          userAgent: true,
        },
      }

      const plugin = useRedwoodLogger(loggerConfig)
      const onExecute = plugin.onExecute

      if (!onExecute) {
        throw new Error('Expected onExecute hook to be defined')
      }

      const onExecuteResult = onExecute({
        args: {
          operationName: 'FetchNativeQuery',
          document: {
            definitions: [
              {
                kind: 'OperationDefinition',
                name: {
                  value: 'FetchNativeQuery',
                },
              },
            ],
          },
          variableValues: {},
          contextValue: {
            request: new Request('http://localhost/graphql', {
              headers: {
                'x-request-id': 'fetch-request-id',
                'user-agent': 'fetch-user-agent',
              },
            }),
            event: createMockLambdaEvent({
              'user-agent': 'legacy-user-agent',
            }),
            requestContext: createMockLambdaContext('legacy-aws-request-id'),
          } as CedarGraphQLContext,
        },
      } as MockOnExecuteArgs)

      if (!onExecuteResult || onExecuteResult instanceof Promise) {
        throw new Error('Expected onExecute to return an onExecuteDone hook')
      }

      const onExecuteDone = onExecuteResult.onExecuteDone

      if (!onExecuteDone) {
        throw new Error('Expected onExecuteDone hook to be defined')
      }

      onExecuteDone({
        args: {} as MockOnExecuteDonePayload['args'],
        result: {
          data: {
            ok: true,
          },
          extensions: {},
        },
        setResult() {
          return undefined
        },
      } as MockOnExecuteDonePayload)

      await watchFileCreated(logFile)

      const logStatements = parseLogFile(logFile)
      const executionStarted = logStatements.find(
        (statement) =>
          statement.msg === 'GraphQL execution started: FetchNativeQuery',
      )

      expect(executionStarted).toMatchObject({
        requestId: 'fetch-request-id',
        userAgent: 'fetch-user-agent',
        operationName: 'FetchNativeQuery',
      })
    })

    it('falls back to legacy event metadata when fetch-native request metadata is absent', async () => {
      const logFile = join(
        os.tmpdir(),
        '_' + Math.random().toString(36).substring(2, 11),
      )

      const logger = createLogger({
        options: {
          level: 'trace',
        },
        destination: logFile,
      })

      const loggerConfig: LoggerConfig = {
        logger,
        options: {
          operationName: true,
          requestId: true,
          userAgent: true,
        },
      }

      const plugin = useRedwoodLogger(loggerConfig)
      const onExecute = plugin.onExecute

      if (!onExecute) {
        throw new Error('Expected onExecute hook to be defined')
      }

      const onExecuteResult = onExecute({
        args: {
          operationName: 'LegacyFallbackQuery',
          document: {
            definitions: [
              {
                kind: 'OperationDefinition',
                name: {
                  value: 'LegacyFallbackQuery',
                },
              },
            ],
          },
          variableValues: {},
          contextValue: {
            event: createMockLambdaEvent({
              'user-agent': 'legacy-user-agent',
            }),
          } as CedarGraphQLContext,
        },
      } as MockOnExecuteArgs)

      if (!onExecuteResult || onExecuteResult instanceof Promise) {
        throw new Error('Expected onExecute to return an onExecuteDone hook')
      }

      const onExecuteDone = onExecuteResult.onExecuteDone

      if (!onExecuteDone) {
        throw new Error('Expected onExecuteDone hook to be defined')
      }

      onExecuteDone({
        args: {} as MockOnExecuteDonePayload['args'],
        result: {
          data: {
            ok: true,
          },
          extensions: {},
        },
        setResult() {
          return undefined
        },
      } as MockOnExecuteDonePayload)

      await watchFileCreated(logFile)

      const logStatements = parseLogFile(logFile)
      const executionStarted = logStatements.find(
        (statement) =>
          statement.msg === 'GraphQL execution started: LegacyFallbackQuery',
      )

      expect(executionStarted).toMatchObject({
        requestId: 'legacy-request-id',
        userAgent: 'legacy-user-agent',
        operationName: 'LegacyFallbackQuery',
      })
    })
  })
})
