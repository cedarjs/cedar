import { WebhookVerificationError, DEFAULT_WEBHOOK_SECRET } from './common.js'
import type { WebhookVerifier, VerifyOptions } from './common.js'

export interface SecretKeyVerifier extends WebhookVerifier {
  type: 'secretKeyVerifier'
}

/**
 * Secret Key Verifier
 *
 * Use when the payload is not signed, but rather authorized via a known secret key
 */
export function secretKeyVerifier(_options?: VerifyOptions): SecretKeyVerifier {
  return {
    sign: ({ secret }) => {
      return secret
    },
    verify: ({ signature, secret = DEFAULT_WEBHOOK_SECRET }) => {
      const verified = signature === secret

      if (!verified) {
        throw new WebhookVerificationError()
      }

      return verified
    },
    type: 'secretKeyVerifier',
  }
}
