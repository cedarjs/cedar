# Provider Contract Tests

Scheduled contract tests that catch "Google/GitHub changed their OAuth API"
before it silently breaks dbAuth's OAuth feature
(`packages/auth-providers/dbAuth/oauth`). This directory implements
"6. Scheduled provider-contract job" in
`docs/implementation-plans/2026-09-01-dbauth-oauth.md` — see that section for
the full design rationale.

No test here ever performs a browser login. Every probe is a plain HTTP call
against a provider's machine-facing surface: discovery/JWKS, the
authorization endpoint, the token endpoint, and the profile endpoint.

Run locally, from the repo root:

```bash
cd tasks/provider-contract-tests && yarn vitest run
```

(There's no dedicated `package.json`/workspace here — like
`tasks/netlify-tests`, `yarn vitest` resolves to the root project's `vitest`
and `oauth4webapi` devDependencies, hoisted into the root `node_modules`.)

## Tiers

### Tier 1 — zero credentials (always runs)

- `google.test.mts`: fetches Google's OIDC discovery document and asserts
  the endpoints/algorithms `createOidcStrategy`
  (`packages/auth-providers/dbAuth/oauth/src/oidc.ts`) relies on
  (`authorization_endpoint`, `token_endpoint`, `jwks_uri`, `code` response
  type, `S256` PKCE, `RS256` id_token signing); fetches the JWKS and asserts
  it parses with usable RSA signing keys.
- `github.test.mts`: probes `/login/oauth/authorize` and
  `/login/oauth/access_token` with a plausible-but-unregistered client id
  and asserts the pinned "unrecognized client" shapes — see the comments in
  that file for the exact live behavior pinned and how it was verified.

Needs no secrets. This is what every scheduled run exercises at minimum.

### Tier 2 — app credentials (env-gated)

One registered OAuth app per provider, holding no production data, minimum
scopes. Proves the client authentication format Cedar's strategies send is
still accepted: posts a bogus authorization code with real client
credentials and asserts the _code_ is rejected (`invalid_grant` /
`bad_verification_code`) rather than the _client_ (`invalid_client` /
`Not Found`, the Tier 1 shape).

Secrets:

| Variable                              | Where it comes from               |
| ------------------------------------- | --------------------------------- |
| `OAUTH_CONTRACT_GOOGLE_CLIENT_ID`     | Google Cloud Console OAuth client |
| `OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth client |
| `OAUTH_CONTRACT_GITHUB_CLIENT_ID`     | GitHub OAuth App settings         |
| `OAUTH_CONTRACT_GITHUB_CLIENT_SECRET` | GitHub OAuth App settings         |

#### Bootstrapping the apps (once)

**Google:** create an OAuth 2.0 Client ID in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials).
Add `http://127.0.0.1:8976/callback` as an authorized redirect URI (used
only by the local bootstrap script below, never in CI). Copy the client
id/secret into the two `OAUTH_CONTRACT_GOOGLE_*` secrets above.

**GitHub:** create an OAuth App at
<https://github.com/settings/applications/new> (any placeholder homepage
and callback URL — this app never completes a real authorization from CI).
Copy the client id and a generated client secret into the two
`OAUTH_CONTRACT_GITHUB_*` secrets above.

### Tier 3 — non-interactive real tokens (env-gated per provider)

Contract-tests the strategies' msw fixtures
(`packages/auth-providers/dbAuth/oauth/src/__tests__/github.strategy.test.ts`)
against live provider responses, as _subset_ shape assertions on only the
fields the strategy reads — a provider adding fields never fails this job.
Also pins the quirks the fixtures freeze: GitHub's `email: null` +
`/user/emails` fallback.

Secrets:

| Variable                              | What it is                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `OAUTH_CONTRACT_GITHUB_TOKEN`         | A GitHub OAuth user access token (see below — **not** a personal access token)      |
| `OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN` | A Google OAuth refresh token, used together with the Tier 2 Google client id/secret |

Apple has no Tier 3: no non-interactive Apple ID authentication exists, and
Apple isn't in dbAuth OAuth's launch scope in the first place (see the
implementation plan).

#### Bootstrapping: GitHub OAuth user token

`OAUTH_CONTRACT_GITHUB_TOKEN` must be an **OAuth user access token** minted
through the Tier 2 GitHub OAuth App's own authorization flow — the same
kind of token `githubProvider` mints for a real user, so it exercises the
same `/user` and `/user/emails` calls the strategy makes. It is **not** a
fine-grained or classic personal access token: those are a different
credential type and don't exercise the OAuth app's token endpoint or the
scopes a real login would request.

To mint one, run a one-time authorize round against the Tier 2 GitHub OAuth
App using a dedicated GitHub account reserved for this contract test (set
that account's email to private, to keep the `email: null` quirk pinned):

1. In a browser, signed in as the dedicated account, open:

   ```
   https://github.com/login/oauth/authorize?client_id=<Tier 2 GitHub client id>&scope=read:user%20user:email&redirect_uri=<the app's callback URL>
   ```

   and approve it. GitHub redirects to the callback URL with a `code` query
   parameter.

2. Exchange that code once, by hand:

   ```bash
   curl -s -X POST https://github.com/login/oauth/access_token \
     -H "Accept: application/json" \
     -d "client_id=<client id>&client_secret=<client secret>&code=<code>"
   ```

3. The response's `access_token` is `OAUTH_CONTRACT_GITHUB_TOKEN`. GitHub
   OAuth user tokens don't expire by default, so this is a true one-time
   bootstrap — re-run only per the re-bootstrap procedure below.

#### Bootstrapping: Google refresh token

Run the helper script with the Tier 2 Google client id/secret in the
environment:

```bash
OAUTH_CONTRACT_GOOGLE_CLIENT_ID=... \
  OAUTH_CONTRACT_GOOGLE_CLIENT_SECRET=... \
  node tasks/provider-contract-tests/bootstrap-google-refresh-token.mts
```

It prints an authorization URL — open it, sign in as the dedicated
contract-test Google account, and grant access. The script catches the
redirect on a local HTTP server, exchanges the code (with
`access_type=offline&prompt=consent`, which is what makes Google issue a
refresh token even on a repeat consent), and prints the refresh token to
set as `OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN`.

With the Google OAuth app in "Production" publishing status (not "Testing"),
the refresh token doesn't expire from inactivity.

## Re-bootstrapping after token death

If Tier 3 starts failing with an authentication error — as opposed to a
shape assertion, which means the job is working as intended:

- **GitHub:** the dedicated account revoked the app, or the OAuth App's
  secret was regenerated. Re-run the GitHub bootstrap steps above and
  update `OAUTH_CONTRACT_GITHUB_TOKEN`.
- **Google:** the refresh token was revoked (manually, via inactivity if the
  app was left in "Testing" publishing status, or per Google's
  unverified-app expiry policy). Re-run
  `bootstrap-google-refresh-token.mts` and update
  `OAUTH_CONTRACT_GOOGLE_REFRESH_TOKEN`.

## Operational shape

`.github/workflows/provider-contract-tests.yml` runs this suite on a weekly
cron plus `workflow_dispatch`, on `cedarjs/cedar` only — never per-PR, so a
provider outage never blocks merges. A failing run opens (or comments on an
existing) GitHub issue titled "Provider contract check failed"; the release
process should check that the latest scheduled run is green.

## Files

- `env.mts` — reads and gates on the secret env vars above.
- `http.mts` — small `fetchJson` helper shared by the test files.
- `google.test.mts`, `github.test.mts` — the three tiers, per provider.
- `bootstrap-google-refresh-token.mts` — local-only helper, see above. Never
  run in CI.
- `vitest.config.mts`, `vitest.setup.mts` — runner config, mirroring
  `tasks/netlify-tests/`.
