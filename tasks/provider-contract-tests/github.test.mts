import { describe, expect, it } from 'vitest'

import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_TOKEN,
  hasGitHubAppCredentials,
  hasGitHubToken,
} from './env.mts'
import { fetchJson } from './http.mts'

const AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize'
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
const PROFILE_ENDPOINT = 'https://api.github.com/user'
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails'

// A client id shaped like a real GitHub OAuth app id (20 lowercase hex
// characters) but never registered, so every probe below exercises
// GitHub's "unrecognized client" path rather than a malformed-input path.
const BOGUS_CLIENT_ID = '0123456789abcdef0123'

interface GitHubProfile {
  id: number
  login: string
  email: string | null
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cedarjs-provider-contract-tests',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

describe('GitHub OAuth endpoints (Tier 1 — zero credentials)', () => {
  it('authorize endpoint is live and echoes an unrecognized client_id into a login redirect', async () => {
    const response = await fetch(
      `${AUTHORIZE_ENDPOINT}?client_id=${BOGUS_CLIENT_ID}`,
      { redirect: 'manual' },
    )

    // Pinned live behavior (verified against the real endpoint on
    // 2026-09-01): GitHub can't reject an invalid client_id before a
    // browser session exists to check it against, so an unauthenticated
    // request to /authorize always 302s to /login first, with `client_id`
    // echoed both directly in the query string and url-encoded inside
    // `return_to`. That's what distinguishes "endpoint is live and
    // processing the client_id" from "endpoint moved" — a genuinely wrong
    // path (verified against .../authorizeXYZ on the same date) 404s
    // outright instead of redirecting.
    expect(response.status).toBe(302)
    const location = response.headers.get('location') ?? ''
    expect(location.startsWith('https://github.com/login?')).toBe(true)
    expect(location).toContain(`client_id=${BOGUS_CLIENT_ID}`)
    expect(location).toContain(encodeURIComponent('/login/oauth/authorize'))
  })

  it('token endpoint rejects an unrecognized client_id with a 404 JSON error', async () => {
    const { status, headers, body } = await fetchJson<{ error?: string }>(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: BOGUS_CLIENT_ID,
          client_secret: 'oauth-contract-test-bogus-secret',
          code: 'oauth-contract-test-bogus-code',
        }),
      },
    )

    // Pinned live behavior (verified against the real endpoint on
    // 2026-09-01): GitHub rejects an unrecognized client_id with a flat 404
    // and a JSON `{ "error": "Not Found" }` body, before it ever looks at
    // the code. This is distinguishable from "endpoint moved" — a
    // genuinely wrong path (verified against .../access_tokenXYZ on the
    // same date) 422s with an HTML body instead.
    expect(status).toBe(404)
    expect(headers.get('content-type')).toContain('application/json')
    expect(body.error).toBe('Not Found')
  })
})

describe.skipIf(!hasGitHubAppCredentials)(
  'GitHub token endpoint (Tier 2 — app credentials)',
  () => {
    it('accepts client authentication and rejects a bogus code as bad_verification_code', async () => {
      const { status, body } = await fetchJson<{ error?: string }>(
        TOKEN_ENDPOINT,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            // Non-null assertions are safe: `describe.skipIf` above only
            // runs this suite when `hasGitHubAppCredentials` is true.
            client_id: GITHUB_CLIENT_ID!,
            client_secret: GITHUB_CLIENT_SECRET!,
            code: 'oauth-contract-test-bogus-code',
          }),
        },
      )

      // Per GitHub's OAuth Apps error documentation, a registered client
      // rejecting a bogus code returns HTTP 200 with `error:
      // "bad_verification_code"` in the body — distinct from the Tier 1
      // `Not Found` shape above, which rejects the client itself. This
      // proves the registered app's client id/secret pair is still
      // accepted.
      expect(status).toBe(200)
      expect(body.error).toBe('bad_verification_code')
    })
  },
)

describe.skipIf(!hasGitHubToken)(
  'GitHub live profile (Tier 3 — non-interactive token)',
  () => {
    it('returns the profile fields the strategy reads, pinning the private-email quirk', async () => {
      const { status, body: profile } = await fetchJson<GitHubProfile>(
        PROFILE_ENDPOINT,
        { headers: githubHeaders(GITHUB_TOKEN) },
      )

      expect(status).toBe(200)

      // Subset assertion on only the fields `githubProvider` reads (see
      // packages/auth-providers/dbAuth/oauth/src/strategies/github.ts) — a
      // profile field GitHub adds later must never fail this job.
      expect(profile).toMatchObject({
        id: expect.any(Number),
        login: expect.any(String),
      })
      expect('email' in profile).toBe(true)

      // Pinned quirk: the dedicated contract-test account keeps its email
      // private, so /user returns `email: null` and the strategy's
      // `/user/emails` fallback (asserted below) is what actually resolves
      // an address. A change to that account's privacy setting flips this
      // assertion — the intended effect, since frozen quirk knowledge
      // should expire loudly rather than rot silently.
      expect(profile.email).toBeNull()
    })

    it('falls back to /user/emails for a primary, verified address', async () => {
      const { status, body: emails } = await fetchJson<GitHubEmail[]>(
        EMAILS_ENDPOINT,
        { headers: githubHeaders(GITHUB_TOKEN) },
      )

      expect(status).toBe(200)
      expect(Array.isArray(emails)).toBe(true)

      const primary = emails.find((email) => email.primary && email.verified)
      expect(primary).toBeDefined()
      expect(typeof primary?.email).toBe('string')
    })
  },
)
