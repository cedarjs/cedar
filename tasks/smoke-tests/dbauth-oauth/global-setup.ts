import { Events, OAuth2Server } from 'oauth2-mock-server'

import { startCrossSiteMockProvider } from './crossSiteMockProvider'

/**
 * Fixed ports the test project (patched by
 * `tasks/test-project/oauth-tasks.mts`) has baked into its `.env` as
 * `OAUTH_MOCK_ISSUER` and `OAUTH_CROSSSITE_AUTHORIZE_URL`. Kept in sync with
 * `OAUTH_MOCK_ISSUER_PORT`/`OAUTH_CROSSSITE_MOCK_PORT` there by hand -- there's
 * no runtime handshake between this suite and that prep script.
 */
const OAUTH_MOCK_ISSUER_PORT = 4317
const OAUTH_CROSSSITE_MOCK_PORT = 4318

/**
 * Claims baked into every id_token the mock OIDC server issues, so the
 * `mock` provider's login is deterministic across runs: the `signup` flow
 * either creates `oauth-mock@example.com` the first time, or (on a rerun
 * against a database that already has that identity) resolves to a login
 * for the same user -- either way the test's assertions hold.
 */
const MOCK_OIDC_CLAIMS = {
  sub: 'mock-oidc-user-1',
  email: 'oauth-mock@example.com',
  email_verified: true,
  name: 'OAuth Mock User',
}

/**
 * Starts the two mock OAuth providers the `dbauth-oauth` suite's test
 * project is configured against, on fixed ports, before any test (or the
 * `webServer`-managed `cedar dev`) runs:
 *
 * - `oauth2-mock-server` on `localhost` (real OIDC discovery/PKCE/id_token
 *   flow) for the same-site happy path.
 * - The tiny hand-rolled provider on `127.0.0.1` (a different site from the
 *   app's `localhost`) for the cross-site `form_post` case.
 *
 * Returns a teardown function, per Playwright's `globalSetup` contract --
 * this keeps both servers' handles in the same process rather than relying
 * on a separate `globalTeardown` module (which would run as a fresh
 * process with no access to them).
 */
export default async function globalSetup() {
  const oidcServer = new OAuth2Server()
  await oidcServer.issuer.keys.generate('RS256')
  oidcServer.service.on(Events.BeforeTokenSigning, (token) => {
    Object.assign(token.payload, MOCK_OIDC_CLAIMS)
  })
  await oidcServer.start(OAUTH_MOCK_ISSUER_PORT, 'localhost')

  const crossSiteProvider = await startCrossSiteMockProvider(
    OAUTH_CROSSSITE_MOCK_PORT,
  )

  return async function globalTeardown() {
    // A `stop()`/`close()` failure on one server must not prevent the other
    // from being torn down, or a single flaky shutdown leaks a listening
    // port into subsequent runs.
    try {
      await oidcServer.stop()
    } finally {
      await crossSiteProvider.close()
    }
  }
}
