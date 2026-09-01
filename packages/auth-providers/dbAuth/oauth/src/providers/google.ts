import { createOidcStrategy } from '../oidc.js'
import type {
  OAuthProviderCredentials,
  OAuthStrategy,
  ProviderPreset,
} from '../types.js'

/**
 * Data-only Google OIDC preset. Google publishes discovery at
 * `https://accounts.google.com/.well-known/openid-configuration`.
 *
 * @see https://developers.google.com/identity/openid-connect/openid-connect
 */
export const GOOGLE_PRESET: ProviderPreset = {
  name: 'Google',
  issuer: 'https://accounts.google.com',
  scope: 'openid email profile',
}

/**
 * Convenience factory: `createOidcStrategy(GOOGLE_PRESET, credentials)`.
 *
 * @example
 * ```ts
 * providers: {
 *   google: googleProvider({
 *     clientId: process.env.GOOGLE_CLIENT_ID,
 *     clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *     redirectUri: `${apiUrl}/auth/oauth/google/callback`,
 *   }),
 * }
 * ```
 */
export function googleProvider(
  credentials: OAuthProviderCredentials,
): OAuthStrategy {
  return createOidcStrategy(GOOGLE_PRESET, credentials)
}
