/**
 * One-time local helper to mint a long-lived Google OAuth refresh token for
 * the Tier 3 provider-contract test (see ./README.md).
 *
 * NOT run in CI — it drives a real browser-facing consent screen, so it
 * only works interactively on a maintainer's machine. Run it once per
 * Google OAuth app (initial bootstrap, or after the refresh token dies) and
 * paste the printed refresh token into the
 * `OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN` GitHub secret.
 *
 * Usage:
 *   OAUTH_CONTRACT_GOOGLE_CLIENT_ID=... \
 *   OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET=... \
 *   node tasks/provider-contract-tests/bootstrap-google-refresh-token.mts
 *
 * The Google Cloud Console OAuth client must have
 * `http://127.0.0.1:8976/callback` registered as an authorized redirect
 * URI.
 */

import { randomBytes } from 'node:crypto'
import http from 'node:http'

const PORT = 8976
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`

const clientId = process.env.OAUTH_CONTRACT_GOOGLE_CLIENT_ID
const clientSecret = process.env.OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error(
    'Set OAUTH_CONTRACT_GOOGLE_CLIENT_ID and OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET ' +
      'first (the same Tier 2 app credentials — see ./README.md).',
  )
  process.exit(1)
}

const state = randomBytes(16).toString('hex')

const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authorizationUrl.searchParams.set('client_id', clientId)
authorizationUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authorizationUrl.searchParams.set('response_type', 'code')
authorizationUrl.searchParams.set('scope', 'openid email profile')
authorizationUrl.searchParams.set('state', state)
// `access_type=offline` + `prompt=consent` is what makes Google issue a
// refresh token even if this Google account already granted the app
// consent before — without `prompt=consent`, a repeat authorization omits
// the refresh token entirely.
authorizationUrl.searchParams.set('access_type', 'offline')
authorizationUrl.searchParams.set('prompt', 'consent')

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      // Non-null: checked above, before the server that calls this
      // function is even started.
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  })

  const body: unknown = await response.json()

  if (!response.ok) {
    throw new Error(
      `Google token exchange failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }

  // The token endpoint is trusted first-party infrastructure reached over
  // TLS with our own client credentials; the shape is asserted implicitly
  // by the caller reading `.refresh_token` off it immediately after.
  return body as TokenResponse
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT_URI)

  if (url.pathname !== '/callback') {
    res.writeHead(404).end('Not found')
    return
  }

  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    res.writeHead(400).end(`Google returned an error: ${oauthError}`)
    console.error(`Google returned an error: ${oauthError}`)
    server.close()
    process.exitCode = 1
    return
  }

  const returnedState = url.searchParams.get('state')
  if (returnedState !== state) {
    res.writeHead(400).end('State mismatch')
    console.error('State mismatch — aborting.')
    server.close()
    process.exitCode = 1
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400).end('Missing code')
    console.error('Callback had no `code` parameter.')
    server.close()
    process.exitCode = 1
    return
  }

  res
    .writeHead(200, { 'Content-Type': 'text/html' })
    .end(
      '<p>Authorized. You can close this tab and return to the terminal.</p>',
    )

  exchangeCode(code)
    .then((tokens) => {
      if (!tokens.refresh_token) {
        console.error(
          'Google did not return a refresh_token. This usually means the ' +
            "account already granted consent and `prompt=consent` didn't " +
            'force a new one — revoke the app at ' +
            'https://myaccount.google.com/permissions and re-run this script.',
        )
        process.exitCode = 1
        server.close()
        return
      }

      console.log(
        '\nSuccess. Set this as the OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN GitHub secret:\n',
      )
      console.log(tokens.refresh_token)
      console.log()
      server.close()
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Token exchange failed: ${message}`)
      process.exitCode = 1
      server.close()
    })
})

server.listen(PORT, () => {
  console.log(
    'Open this URL, sign in with the dedicated contract-test Google account, and grant access:\n',
  )
  console.log(authorizationUrl.toString())
  console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...`)
})
