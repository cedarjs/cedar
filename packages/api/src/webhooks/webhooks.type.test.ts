import type { APIGatewayProxyEvent } from 'aws-lambda'
import { describe, test, expectTypeOf } from 'vitest'

import type {
  WebhookVerificationError,
  DEFAULT_WEBHOOK_SECRET,
  DEFAULT_WEBHOOK_SIGNATURE_HEADER,
  signatureFromEvent,
  verifyEvent,
  verifySignature,
  signPayload,
  VerifyOptions,
  SupportedVerifierTypes,
} from './index.js'

describe('webhooks type tests', () => {
  describe('VerifyOptions type', () => {
    test('should be an interface with optional properties', () => {
      expectTypeOf<VerifyOptions>().toEqualTypeOf<{
        signatureHeader?: string
        signatureTransformer?: (signature: string) => string
        currentTimestampOverride?: number
        eventTimestamp?: number
        tolerance?: number
        issuer?: string
      }>()
    })

    test('should allow empty object', () => {
      expectTypeOf<Record<string, never>>().toExtend<VerifyOptions>()
    })

    test('should allow partial objects', () => {
      expectTypeOf<{ signatureHeader: string }>().toExtend<VerifyOptions>()
      expectTypeOf<{ tolerance: number }>().toExtend<VerifyOptions>()
      expectTypeOf<{
        signatureHeader: string
        tolerance: number
      }>().toExtend<VerifyOptions>()
    })

    test('should enforce correct property types', () => {
      expectTypeOf<VerifyOptions['signatureHeader']>().toEqualTypeOf<
        string | undefined
      >()
      expectTypeOf<VerifyOptions['signatureTransformer']>().toEqualTypeOf<
        ((signature: string) => string) | undefined
      >()
      expectTypeOf<VerifyOptions['currentTimestampOverride']>().toEqualTypeOf<
        number | undefined
      >()
      expectTypeOf<VerifyOptions['eventTimestamp']>().toEqualTypeOf<
        number | undefined
      >()
      expectTypeOf<VerifyOptions['tolerance']>().toEqualTypeOf<
        number | undefined
      >()
      expectTypeOf<VerifyOptions['issuer']>().toEqualTypeOf<
        string | undefined
      >()
    })
  })

  describe('SupportedVerifierTypes type', () => {
    test('should be a union of string literals', () => {
      expectTypeOf<SupportedVerifierTypes>().toEqualTypeOf<
        | 'skipVerifier'
        | 'secretKeyVerifier'
        | 'sha1Verifier'
        | 'sha256Verifier'
        | 'base64Sha1Verifier'
        | 'base64Sha256Verifier'
        | 'timestampSchemeVerifier'
        | 'jwtVerifier'
      >()
    })

    test('should accept valid verifier types', () => {
      expectTypeOf<'skipVerifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'secretKeyVerifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'sha1Verifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'sha256Verifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'base64Sha1Verifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'base64Sha256Verifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'timestampSchemeVerifier'>().toMatchTypeOf<SupportedVerifierTypes>()
      expectTypeOf<'jwtVerifier'>().toMatchTypeOf<SupportedVerifierTypes>()
    })
  })

  describe('WebhookVerificationError class', () => {
    test('should be a class constructor', () => {
      expectTypeOf<typeof WebhookVerificationError>().toBeConstructibleWith()
      expectTypeOf<typeof WebhookVerificationError>().toBeConstructibleWith('')
      expectTypeOf<typeof WebhookVerificationError>().toBeConstructibleWith(
        'custom message',
      )
    })

    test('should extend Error', () => {
      expectTypeOf<
        InstanceType<typeof WebhookVerificationError>
      >().toExtend<Error>()
    })

    test('should have Error properties', () => {
      expectTypeOf<
        InstanceType<typeof WebhookVerificationError>['message']
      >().toEqualTypeOf<string>()
      expectTypeOf<
        InstanceType<typeof WebhookVerificationError>['name']
      >().toEqualTypeOf<string>()
      expectTypeOf<
        InstanceType<typeof WebhookVerificationError>['stack']
      >().toEqualTypeOf<string | undefined>()
    })
  })

  describe('DEFAULT_WEBHOOK_SECRET constant', () => {
    test('should be a string', () => {
      expectTypeOf<typeof DEFAULT_WEBHOOK_SECRET>().toExtend<string>()
    })

    test('should be assignable to string', () => {
      expectTypeOf<typeof DEFAULT_WEBHOOK_SECRET>().toExtend<string>()
    })
  })

  describe('DEFAULT_WEBHOOK_SIGNATURE_HEADER constant', () => {
    test('should be a string', () => {
      expectTypeOf<typeof DEFAULT_WEBHOOK_SIGNATURE_HEADER>().toExtend<string>()
    })

    test('should be assignable to string', () => {
      expectTypeOf<typeof DEFAULT_WEBHOOK_SIGNATURE_HEADER>().toExtend<string>()
    })

    test('should be the expected literal value', () => {
      expectTypeOf<typeof DEFAULT_WEBHOOK_SIGNATURE_HEADER>().toExtend<string>()
    })
  })

  describe('function type signatures', () => {
    test('signatureFromEvent should have correct signature', () => {
      expectTypeOf<typeof signatureFromEvent>().toEqualTypeOf<
        ({
          event,
          signatureHeader,
        }: {
          event: APIGatewayProxyEvent
          signatureHeader: string
        }) => string
      >()
    })

    test('verifyEvent should have correct signature', () => {
      expectTypeOf<typeof verifyEvent>().toEqualTypeOf<
        (
          type: SupportedVerifierTypes,
          args: {
            event: APIGatewayProxyEvent
            payload?: string
            secret?: string
            options?: VerifyOptions | undefined
          },
        ) => boolean | WebhookVerificationError
      >()
    })

    test('verifySignature should have correct signature', () => {
      expectTypeOf<typeof verifySignature>().toEqualTypeOf<
        (
          type: SupportedVerifierTypes,
          args: {
            payload: string | Record<string, unknown>
            secret: string
            signature: string
            options?: VerifyOptions | undefined
          },
        ) => boolean | WebhookVerificationError
      >()
    })

    test('signPayload should have correct signature', () => {
      expectTypeOf<typeof signPayload>().toEqualTypeOf<
        (
          type: SupportedVerifierTypes,
          args: {
            payload: string
            secret: string
            options?: VerifyOptions | undefined
          },
        ) => string
      >()
    })
  })

  describe('function parameter compatibility', () => {
    test('verifyEvent should accept valid parameters', () => {
      const mockEvent = {} as APIGatewayProxyEvent
      const validType: SupportedVerifierTypes = 'sha256Verifier'
      const validOptions: VerifyOptions = {
        signatureHeader: 'custom-header',
        tolerance: 30000,
      }

      expectTypeOf<Parameters<typeof verifyEvent>>().toEqualTypeOf<
        [
          SupportedVerifierTypes,
          {
            event: APIGatewayProxyEvent
            payload?: string
            secret?: string
            options?: VerifyOptions | undefined
          },
        ]
      >()

      // Test that function calls would be type-safe
      expectTypeOf<typeof verifyEvent>().toBeCallableWith(validType, {
        event: mockEvent,
        secret: 'test-secret',
        options: validOptions,
      })
    })

    test('verifySignature should accept valid parameters', () => {
      const validType: SupportedVerifierTypes = 'sha1Verifier'
      const validOptions: VerifyOptions = { tolerance: 5000 }

      expectTypeOf<typeof verifySignature>().toBeCallableWith(validType, {
        payload: 'test payload',
        secret: 'test-secret',
        signature: 'test-signature',
        options: validOptions,
      })

      expectTypeOf<typeof verifySignature>().toBeCallableWith(validType, {
        payload: { data: 'test' },
        secret: 'test-secret',
        signature: 'test-signature',
      })
    })

    test('signPayload should accept valid parameters', () => {
      const validType: SupportedVerifierTypes = 'jwtVerifier'
      const validOptions: VerifyOptions = { issuer: 'test-issuer' }

      expectTypeOf<typeof signPayload>().toBeCallableWith(validType, {
        payload: 'test payload',
        secret: 'test-secret',
        options: validOptions,
      })
    })
  })
})
