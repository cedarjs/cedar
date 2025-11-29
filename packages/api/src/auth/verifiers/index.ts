import { verifierLookup } from './common.js'
import type {
  SupportedVerifierTypes,
  VerifyOptions,
  WebhookVerifier,
} from './common.js'

/**
 * @param {SupportedVerifierTypes} type - What verification type methods used to sign and verify signatures
 * @param {VerifyOptions} options - Options used to verify the signature based on verifiers requirements
 */
export const createVerifier = (
  type: SupportedVerifierTypes,
  options?: VerifyOptions,
): WebhookVerifier => {
  const verifierFactory = verifierLookup[type]

  if (options) {
    return verifierFactory(options)
  } else {
    return verifierFactory()
  }
}

export * from './common.js'
