/**
 * Shared env-var gating for the provider-contract test tiers.
 *
 * Tier 1 (discovery/JWKS/authorize/token-shape probes) needs no credentials
 * and always runs. Tiers 2 and 3 read these variables and skip cleanly (via
 * `describe.skipIf` in the test files) when they're unset, so the suite is
 * green with zero secrets and only exercises live app credentials/tokens
 * once a maintainer or CI has provisioned them. See ./README.md for how to
 * bootstrap each one.
 */

export const GOOGLE_CLIENT_ID = process.env.OAUTH_CONTRACT_GOOGLE_CLIENT_ID
export const GOOGLE_CLIENT_SECRET =
  process.env.OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET
export const GITHUB_CLIENT_ID = process.env.OAUTH_CONTRACT_GITHUB_CLIENT_ID
export const GITHUB_CLIENT_SECRET =
  process.env.OAUTH_CONTRACT_GITHUB_CLIENT_SECRET
export const GITHUB_TOKEN = process.env.OAUTH_CONTRACT_GITHUB_TOKEN
export const GOOGLE_REFRESH_TOKEN =
  process.env.OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN

export const hasGoogleAppCredentials = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET,
)
export const hasGitHubAppCredentials = Boolean(
  GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET,
)
export const hasGitHubToken = Boolean(GITHUB_TOKEN)

// The Tier 3 Google refresh-token grant also needs the Tier 2 app
// credentials to authenticate the client, so it's gated on both.
export const hasGoogleRefreshToken = Boolean(
  GOOGLE_REFRESH_TOKEN && hasGoogleAppCredentials,
)
