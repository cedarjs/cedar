export { OAuthHandler } from './OAuthHandler.js'
export * from './errors.js'
export * from './types.js'
export { createOidcStrategy } from './oidc.js'
export { GOOGLE_PRESET, googleProvider } from './providers/google.js'
export { githubProvider } from './strategies/github.js'
export {
  parseOAuthRoute,
  parseAuthorizeFlow,
  normalizeOAuthRequest,
} from './request.js'
export type { NormalizedOAuthRequest, OAuthRoute } from './request.js'
export {
  TRANSACTION_COOKIE_NAME,
  DEFAULT_TRANSACTION_EXPIRES_SECONDS,
} from './transactionCookie.js'
