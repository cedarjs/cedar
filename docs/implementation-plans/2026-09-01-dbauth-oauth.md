# dbAuth OAuth Support — Decision Record & Implementation Plan

Status: Decision made, not yet implemented. This document captures the research
and decisions so work can be picked up later.

## TL;DR

Add OAuth login to dbAuth as an **opt-in feature, WebAuthn-style, in a new
package inside this monorepo**:

- Protocol core built on
  **[oauth4webapi](https://github.com/panva/oauth4webapi)** (decided — do not
  hand-roll authorization-code/PKCE/OIDC verification).
- Providers expressed as **data presets** (issuer/clientId/scopes) resolved via
  OIDC discovery wherever possible, plus built-in strategies for providers that
  need real code, and a custom-strategy escape hatch.
- **Launch scope (decided): Google and GitHub ship implemented from the start**
  — Google as an OIDC preset, GitHub as a built-in strategy. Every other
  provider (Apple and Facebook included) is served by the custom-strategy escape
  hatch, with documented worked examples.
- OAuth gets its **own endpoint path** (e.g. `/auth/oauth`), not new entries in
  `DbAuthHandler`'s `METHODS`/`VERBS` dispatch table (decided — see "Endpoint
  shape" below).
- Hard prerequisite: a **public session-issuance API** in
  `@cedarjs/auth-dbauth-api`, usable from both the auth function and the SSR
  middleware.

Do **not** build it into the default dbAuth flow, and do **not** put it in a
separate repo.

## The question

How should CedarJS support OAuth logins with dbAuth? Options considered:

1. Built-in as a base dbAuth feature
2. Optional extra, like WebAuthn is today
3. Separate repo in the cedarjs org

## Research: the original objections (and what they actually were)

The historical context is from RedwoodJS days, before the Cedar fork. Two key
voices. The Rob quotes below are verified verbatim against
[Irev-Dev/redwood#45](https://github.com/Irev-Dev/redwood/pull/45).

### Rob Cameron (cannikin, dbAuth author)

Rob was **not** opposed to OAuth in dbAuth. On Kurt Hutten's Dec 2021
proof-of-concept PR (built-in GitHub login, dispatched through a new `sso`
method on `DbAuthHandler`), Kurt asked directly whether this was a feature
Redwood would want. Rob's answer, verbatim:

> Definitely, as long as it doesn't make any major changes to the default dbAuth
> flow and the minimal config we have now if you just want to stick with
> username/password authentication.

His conditions:

- **Default flow untouched.** Username/password apps see zero added config or
  behavior change.
- **Generic, not provider-specific.** He was "a little nervous about all the
  hard-coded 'github's" and wanted an OmniAuth-inspired architecture: a generic
  core that knows no providers, with providers pluggable as "strategies"
  (separate packages, listed in one config block).
- **Account linking.** Multiple third-party providers on one account, plus the
  ability to add email/password to a provider-only account.
- **Setup flags + generated pages.** He sketched
  `yarn rw setup auth dbAuth --db --twitter --github`, and wanted generated
  login/signup pages to automatically include buttons for configured providers.

### David Thyresson (dthyresson)

The actual opposition was DT's slippery-slope argument:

> Personally, this is a slippery slope towards implementing full-featured
> authentication service inside Redwood and is something I am not in favor of.
>
> If you are not careful you'll have to build soooo much. Mail. Password
> strength. Auditing. Admin api. Callback whitelisting. App and user metadata.
> Multiple identity provider support. Account blocking. Login attempt anomaly
> detection. IP address spoof detection. Token refreshing. [...]
>
> I see dbAuth as a light weight and limited alternative to the authentication
> as a service providers and one that should be used with some understanding of
> its limitations. It's nice to get you started.
>
> Authentication isn't just a user record in a database. It's a product.

### Reconciling the two

Both positions are compatible, and WebAuthn already reconciled them in practice:
an opt-in feature that (a) ships protocol-level code, not per-vendor
integrations, (b) is invisible when disabled. The same shape satisfies Rob's
conditions and avoids DT's slope. Using oauth4webapi strengthens the answer to
DT further: the protocol maintenance burden lands on a widely-used, audited,
zero-dependency library rather than on Cedar.

Recurring demand in the community threads came from two crowds: enterprise /
self-hosted users (Keycloak, GitLab, Azure — OIDC), and social-login users
(GitHub, Google, Apple). Both are served by an OIDC-first core.

## Current dbAuth architecture (this repo, as of Aug 2026)

Packages:

| Package                           | Path                                        | Role                                                                                                                                |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@cedarjs/auth-dbauth-api`        | `packages/auth-providers/dbAuth/api`        | Server-side core. `src/DbAuthHandler.ts` (~1600 lines), `src/shared.ts` (session crypto/cookies/password hashing), `src/decoder.ts` |
| `@cedarjs/auth-dbauth-web`        | `packages/auth-providers/dbAuth/web`        | Web client. `src/dbAuth.ts`, `src/webAuthn.ts` (subpath `/webAuthn`)                                                                |
| `@cedarjs/auth-dbauth-setup`      | `packages/auth-providers/dbAuth/setup`      | CLI setup templates/tasks, `src/templates/{api,web}/`                                                                               |
| `@cedarjs/auth-dbauth-middleware` | `packages/auth-providers/dbAuth/middleware` | SSR/RSC middleware                                                                                                                  |
| `@cedarjs/auth`                   | `packages/auth`                             | Provider-agnostic web-side auth framework (`AuthImplementation` interface)                                                          |

### How WebAuthn is wired in (the blueprint to copy)

- **Config toggle:** `DbAuthHandlerOptions.webAuthn` — every webAuthn method
  guards with a check and throws `DbAuthError.WebAuthnError` when disabled.
- **Paired config:** `credentialModelAccessor` must be present iff `webAuthn` is
  — enforced in `_validateOptions()`.
- **Routing:** static `METHODS`/`VERBS` getters on `DbAuthHandler` are the
  dispatch table; `invoke()` routes `?method=` / verbs to
  `await this[method]()`. WebAuthn added four routes (`webAuthnRegOptions`,
  `webAuthnRegister`, `webAuthnAuthOptions`, `webAuthnAuthenticate`).
- **Optional dependency:** `@simplewebauthn/server` is an _optional peer
  dependency_ of dbauth-api; each webAuthn method does a lazy
  `await import('@simplewebauthn/server')` so the dep is only loaded when
  webAuthn routes are invoked. The web side also lazy-imports
  `@simplewebauthn/browser`, though there it is a regular dependency of
  `@cedarjs/auth-dbauth-web`, not an optional peer.
- **Schema:** setup adds a `webAuthnChallenge` column to `User` plus a new
  `UserCredential` model; field names mapped via config (`authFields.challenge`,
  `webAuthn.credentialFields`).
- **Templates:** separate `*.webAuthn.*` template variants
  (`templates/api/functions/auth.webAuthn.ts.template`,
  `templates/web/auth.webAuthn.ts.template`); `cli-helpers` picks the variant
  based on the setup flag.
- **Secrets redaction:** `packages/cli/src/commands/generate/helpers.ts`
  `SENSITIVE_FIELDS` includes `webAuthnChallenge` so SDL/scaffold generators
  never expose it.
- **Generated pages:** `login.webAuthn.tsx.template`; the pages generator
  auto-detects webauthn setup by grepping web `package.json` for
  `@simplewebauthn/browser`.
- **Session issuance:** `webAuthnAuthenticate()` proves identity, fetches the
  user, and hands off to the private `_loginResponse(user)` — which mints the
  CSRF token, session cookie, and `auth-provider` cookie. Any new auth flow can
  reuse this by returning a user.

### Session cookie internals

- `DbAuthHandler._loginResponse(user)` — the single session-issuance entry point
  (private).
- `DbAuthHandler._createSessionCookieString(data, csrfToken)` — builds
  `JSON.stringify(data) + ';' + csrfToken`, encrypts, joins cookie attributes
  (private).
- `encryptSession` / `decryptSession` in `shared.ts` — AES-256-CBC keyed by
  `SESSION_SECRET`. **These are public exports** (via
  `export * from './shared.js'` in the package index), but the cookie-string
  builders are not.

Key gap: there is no public API for "authenticate this user and hand me the full
login response." `encryptSession` alone isn't enough — callers need the CSRF
token pairing and cookie attributes, which live in private methods.

### The middleware seam (required, easy to miss)

SSR/RSC apps authenticate through `@cedarjs/auth-dbauth-middleware`, not the
`functions/auth.ts` handler. Any OAuth feature must work in both worlds:

- The public session-issuance API (below) must be callable from middleware
  request handling, not only from inside a `DbAuthHandler` instance.
- The OAuth callback endpoint must be reachable/routable in middleware-based
  apps as well as function-based apps.

Neither the old how-to nor the community plugin handles this; it is a hard
requirement here.

## The two existing resources, assessed

### Official how-to (cedarjs.com/docs/how-to/oauth)

Manual recipe: a link to the provider, a hand-written `/oauth` function that
exchanges the code, an `Identity` table, and a **hand-rolled session cookie
built with CryptoJS**.

Problems:

- The CryptoJS-encrypted cookie only works because `decryptSession` keeps a
  legacy fallback path for old-format sessions. It's encrypting with the legacy
  KDF, not the current AES-256-CBC format.
- The cookie payload omits the CSRF token, so the session is missing the
  `data;csrf` structure the handler expects.
- The cookie name is hardcoded and already broke once (the guide carries a
  comment about v7.6.2 changing the cookie name).
- **No `state` parameter in the OAuth flow — a login-CSRF vulnerability.**
  Nobody should copy this recipe.
- Everything is drift-prone by construction: every dbAuth internals change
  (cookie format, attributes, name) silently breaks hand-rolled copies.

Useful takeaway: the `Identity` model design (option 4 in the guide — separate
one-to-many table keyed `(provider, uid)`) is the right schema shape.

### Community plugin (spoonjoy/redwoodjs-dbauth-oauth)

Two packages (`@spoonjoy/redwoodjs-dbauth-oauth-{api,web}`), 18 stars, in
production at spoonjoy.app. Built against Redwood 8.1.1; last commit Sept 2024.
Descends from realStandal (Ryan Lockard, Redwood core-team alumnus)'s earlier
effort.

Architecture is sound as a _seam_ and worth adopting:

- `OAuthHandler` class receives `(event, context, authHandler, config)` — it
  **reuses the live `DbAuthHandler` instance** rather than reimplementing
  session logic. This is the correct integration seam.
- `OAuth` prisma model (`provider`, `providerUserId`, `providerUsername`,
  `userId`) with `@@unique([provider, providerUserId])` and
  `@@unique([userId, provider])`.
- Makes `hashedPassword`/`salt` (and any non-identity User fields) optional so
  provider-only accounts can exist.
- **Three distinct flows — `login`, `signup`, `link` — with the deliberate
  property that a user can never accidentally create a duplicate account by
  logging in with a provider.** This UX design is the plugin's best idea and
  should be preserved. Guards include: cannot unlink the last provider when the
  account has no password; cannot sign up when the provider email matches an
  existing account.

Problems — port the UX and the seam, **port none of the provider/protocol
code**:

- **Security: `_verifyIdToken` is a TODO that returns the id_token unverified**
  — no signature, `iss`, `aud`, `exp`, or nonce checks. Google and Apple logins
  trust an unvalidated JWT.
- **Security: no CSRF protection in the OAuth flow.** `state` is used as a
  return-URL carrier, not a nonce, and there is no PKCE.
- Requires manual surgery on `auth.ts` (path-based switch on `event.path`),
  `App.tsx` (wrap in `OAuthProvider`), and the prisma schema. Every re-run of
  setup clobbers or conflicts with this.
- Provider set (apple/github/google) is hardcoded as `switch` statements.
- Reaches into `_`-prefixed private `DbAuthHandler` methods
  (`_createSessionCookieString`, `_getCurrentUser`, `_ok`, ...), so any
  internals refactor breaks it.
- Maintenance risk: one maintainer, tracks core from the outside. This is the
  structural failure mode of the separate-repo option.

## Decisions

### 1. Opt-in feature, WebAuthn-style, in this monorepo

- **WebAuthn is the exact blueprint Rob asked for.** Opt-in config flag,
  optional lazy-imported dependency, setup flag with template variants, schema
  additions, secret-field redaction, buttons in generated pages, and zero impact
  on apps that don't enable it.
- **In-monorepo, not a separate repo.** An OAuth handler is deeply coupled to
  dbAuth (event shape, `authFields`, cookie config, session minting) and the
  setup/template machinery in `cli-helpers`. A separate repo perpetually chases
  core — the community plugin's failure mode. A separate _package_ (e.g.
  `packages/auth-providers/dbAuth/oauth`) keeps the boundary Rob wanted while
  getting lockstep releases and shared CI. It can be extracted later if it
  stabilizes.
- **Not a base feature.** That fails Rob's first condition and walks straight
  onto DT's slope.

### 2. Protocol core: oauth4webapi (decided)

Use [`oauth4webapi`](https://github.com/panva/oauth4webapi) for the
authorization-code + PKCE flow, `state`/`nonce` handling, token exchange, OIDC
discovery, id_token validation (JWKS), and userinfo. Rationale:

- Zero runtime dependencies, security-audited, actively maintained by the author
  of `openid-client`, built on Web Crypto/fetch (works in Node 20+ and edge
  runtimes — relevant for the middleware seam).
- Hand-rolled JWT/JWKS verification and missing `state`/PKCE are exactly where
  both prior art efforts (the how-to and the plugin) have security holes.
- For Apple's client authentication (an ES256-signed JWT used as the client
  secret), generate the assertion with panva's `jose` (also zero-dep) rather
  than `jsonwebtoken`.

**Considered and rejected: [Arctic](https://github.com/pilcrowOnPaper/arctic)**
(per-provider OAuth client library with ~50 provider classes, by the Lucia
author). Its author deprecated the npm package in July 2026
([blog post](https://pilcrowonpaper.com/blog/18)), citing: provider bloat, a
uniform API that cannot be tailored to each provider's OAuth 2.0 quirks, and —
most fundamentally — that OAuth 2.0 is the wrong layer to abstract into a
library at all ("too tied down to the underlying HTTP protocol"; libraries
should target "an abstraction one or two layers above it"). That analysis
matches this plan's shape exactly: oauth4webapi implements the tight,
security-sensitive specs (PKCE, OIDC discovery, JWKS verification), thin
Cedar-owned strategies hold the per-provider quirks, and the Cedar package
itself is the layer-above abstraction (flow + session + linking). Arctic's
deprecation also removes it as a viable dependency for long-tail provider
coverage; the custom-strategy hook is the answer there instead.

### 3. Providers: presets first, thin strategies where unavoidable

- OIDC-compliant providers (Google, Keycloak, Auth0, GitLab, Azure AD, ...) are
  **data presets**: issuer URL, client id/secret env var names, scopes.
  Discovery does the rest.
- **"No provider code at all" is not achievable**: GitHub — the most-requested
  provider — issues no id_tokens in its standard user OAuth flow (the OIDC
  discovery metadata it publishes is a preview for MCP clients only) and has
  custom userinfo/email endpoints, and
  Apple needs the signed client-secret JWT and `response_mode=form_post` (which
  pressures `SameSite` on the session cookie). Built-in strategies sit behind
  the same interface as the presets, and stay thin.
- **Launch scope: Google (preset) and GitHub (built-in strategy) ship
  implemented from the start. No other provider ships built-in.** Apple stays
  out of the launch scope because of the client-secret JWT, `form_post`, and
  `SameSite` implications; it remains the interface acceptance test (below) and
  a documented escape-hatch example. Providers can be promoted from worked
  example to built-in later with zero architectural change.
- A custom-strategy hook (`getProviderUser`-style) is the escape hatch for
  anything else, so Cedar never has to chase long-tail vendors. The contract
  requires every strategy to return a stable, canonical provider user id
  (`sub` from a validated id_token for OIDC; the provider's immutable user id
  otherwise) — account lookup keys on `(provider, providerUserId)`, never on
  email or username. Facebook is the
  worked example to document for it: the same OAuth2-plus-userinfo shape as
  GitHub (versioned Graph API endpoints, `email` scope, no guaranteed email on
  the profile, `state`-only CSRF protection since PKCE support is inconsistent).
- **Reference code for writing the strategies:** Arctic's deprecated-but-frozen
  provider implementations are a well-tested catalog of per-provider endpoint
  and quirk knowledge — copy the knowledge, not the dependency. Pinned to the
  final release tag (v3.7.0):
  - [GitHub](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/src/providers/github.ts)
    ([docs](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/docs/pages/providers/github.md))
  - [Apple](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/src/providers/apple.ts)
    ([docs](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/docs/pages/providers/apple.md))
  - [Facebook](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/src/providers/facebook.ts)
    ([docs](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/docs/pages/providers/facebook.md))
  - [Google](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/src/providers/google.ts)
    ([docs](https://github.com/pilcrowOnPaper/arctic/blob/v3.7.0/docs/pages/providers/google.md))
    — useful for cross-checking the OIDC preset defaults
  - The author's library-free replacement examples (authorization request, code
    exchange, refresh, revocation — each with and without PKCE) live in
    [`code/` on `main`](https://github.com/pilcrowOnPaper/arctic/tree/main/code)
    and are what [arcticjs.dev](https://arcticjs.dev) now serves.
- Apple's `SameSite=None` requirement should never be imposed on apps that don't
  enable Apple; document it as an Apple-specific consequence.
- **Acceptance criterion for the strategy interface: Apple must be implementable
  purely through the public strategy interface** (and Cedar's built-in
  strategies must use only that interface — no private back-doors). Apple is the
  stress test because it needs everything a naive hook contract omits: dynamic
  client authentication (the ES256 client-secret JWT), callbacks arriving as
  cross-site `form_post` POSTs rather than GETs, access to raw callback params
  (Apple sends the user's name/email in a one-time `user` form field), and
  defined transaction-cookie behavior across a cross-site POST. If Apple works
  in userland, any provider does — and community strategy packages
  (`cedarjs-oauth-strategy-<provider>`) become safe, because they depend on a
  small public interface instead of dbAuth internals.

### 4. Endpoint shape: separate path, not `METHODS`/`VERBS` dispatch (decided)

WebAuthn fits inside `DbAuthHandler`'s dispatch table because it is a credential
flow: JSON POSTs from the web client, JSON responses back. OAuth is a **redirect
flow**: the browser leaves for the provider, comes back via GET (or `form_post`)
to a callback URL that is registered with the provider, and the response is a
302 back into the app. Shoehorning that into a class whose contract is "return
JSON to the dbAuth web client" means a parallel redirect-based path inside
`DbAuthHandler` — the scope creep Rob's first condition rules out.

So: the OAuth handler owns its own path (`/auth/oauth`, matching the community
plugin's seam), dispatched by the generated auth function template — not by
user-maintained code, so setup re-runs stay idempotent — and reachable from the
middleware router in SSR apps.

## Hard prerequisite: public session-issuance API

Both existing resources stumble on the same missing piece — there is no
supported way to say "this user just authenticated; mint a session." Export a
`createLoginResponse(user, options)`-style function from
`@cedarjs/auth-dbauth-api` (essentially lifting `_loginResponse` +
`_createSessionCookieString` into a public, tested API), designed so the
middleware package can call it too. This kills the hand-rolled-cookie class of
bugs, is useful to any third-party integration (magic links, impersonation,
SSO), and is independently valuable as a standalone PR.

## Implementation plan

1. **Public session issuance.** Lift `_loginResponse` /
   `_createSessionCookieString` logic into a public exported function in
   dbauth-api; rewire the private methods to use it; make it consumable from
   `@cedarjs/auth-dbauth-middleware`. Foundation PR, lands first.
2. **OAuth core package.** New package under
   `packages/auth-providers/dbAuth/oauth`, wrapping a `DbAuthHandler` instance
   (the community plugin's seam, but through public APIs only). Built on
   oauth4webapi: authorization-code + PKCE, `state` validation, token exchange,
   OIDC discovery + id_token verification + userinfo. `ProviderPreset` type; a
   Google preset and a built-in GitHub strategy (the launch scope);
   custom-strategy hook. Session creation via the API from step 1.
   `oauth4webapi` as a lazy-imported optional peer dependency, mirroring
   `@simplewebauthn/server` (`jose` joins it only if Apple is ever promoted to
   built-in, for the client-secret JWT).
3. **Setup integration.** `cedar setup auth dbAuth --oauth <provider,...>` flag:
   template variant of the auth function that routes `/auth/oauth` to the OAuth
   handler (no manual path-switching in user code), `OAuth`-style identity model
   added to the prisma schema, password fields made optional, provider env vars
   stubbed into `.env`, any stored secret columns added to `SENSITIVE_FIELDS`.
4. **Web side + generated pages.** OAuth client (`getOAuthUrls`,
   link/unlink/connected-accounts), wiring in the generated `auth.ts`, and
   provider buttons added to generated login/signup pages when OAuth is
   configured (Rob's ask). Preserve the community plugin's login/signup/link
   distinction so duplicate accounts can't be created accidentally.
5. **Docs.** Rewrite the OAuth how-to around the new feature, or reduce it to
   "use the feature; here's how the custom-strategy hook works." The current
   recipe (no `state`, legacy cookie crypto) should not remain the documented
   path.
6. **Community outreach.** Invite the spoonjoy plugin author (Ari Mendelow) to
   contribute — the plugin descends from a core-team alumnus' work, is
   production-tested, and its UX decisions (link/login/signup separation
   especially) are worth porting directly, with credit.

## Testing strategy

Everything ships integration-tested, and no test ever performs a browser login
against a real provider (real logins in CI mean credentials, bot detection,
consent screens, and flakiness). The feature is testable this way because
oauth4webapi talks real HTTP — point it at a local spec-compliant identity
provider and the genuine protocol runs end to end.

### 1. In-package integration tests (vitest)

Extend the existing dbauth-api test pattern
(`packages/auth-providers/dbAuth/api/src/__tests__/DbAuthHandler.test.js` and
its `.fetch.test.js` twin: mock Prisma accessor + constructed Lambda events /
Fetch `Request`s):

- Run **`oauth2-mock-server`** in-process (`beforeAll`): real discovery
  document, JWKS, token endpoint, signed JWTs. Point the strategy's issuer at
  `http://localhost:<port>` and the full oauth4webapi path — discovery, code
  exchange, id_token verification — executes for real, no mocking of the
  protocol code. Note: oauth4webapi rejects `http:` endpoints by default, so
  the test setup (and only the test setup) must pass its
  `allowInsecureRequests` option for the local issuer.
- Drive the whole dance without a browser: login-start request → assert 302 +
  `state`/PKCE transaction cookie → callback request with the issued code →
  assert the session cookie decrypts via `decryptSession` with the `data;csrf`
  structure, and the identity row is created.
- This layer exhaustively covers the semantics: login vs signup vs link,
  duplicate-email guard, unlink-last-provider-without-password guard,
  tampered/missing `state` rejected, replayed code rejected, error-redirect
  shapes, `form_post` callbacks (POST with form body honoring the transaction
  cookie).
- **Non-OIDC strategies (GitHub/Facebook shape):** stub token + userinfo
  endpoints with **msw** (already a dependency of `packages/testing`), using
  recorded real responses as fixtures. Quirk knowledge is frozen here: a GitHub
  profile with `email: null`, a Facebook profile with no email, Apple's one-time
  `user` form field.

### 2. Middleware seam (vitest)

Mirror
`packages/auth-providers/dbAuth/middleware/src/__tests__/initDbAuthMiddleware.test.ts`:
the same flows driven through the middleware entry point, enforcing in CI that
the function-handler and SSR worlds both work.

### 3. Real IdP in CI: Keycloak service container

A GitHub Actions job runs **Keycloak in a Docker service container**: a
production-grade OIDC provider, fully headless (admin REST API seeds
realm/client/user; its login page is plain HTML a test can POST to). This proves
discovery/JWKS/PKCE against real third-party software and doubles as the
flagship enterprise scenario (the Keycloak preset) from the community threads.

### 4. Browser E2E (Playwright, `tasks/smoke-tests` pattern)

One scenario against a test project (`__fixtures__/test-project` + tarsync) with
OAuth configured against the mock server or Keycloak: click the generated "Log
in with …" button, ride the redirects, assert `currentUser` via GraphQL. This is
the only layer that proves cookie reality (HttpOnly/SameSite, the transaction
cookie surviving the redirect round-trip) and that generated pages are wired up.
Note: `localhost:8910` vs `localhost:9000` are _same-site_, so honestly testing
Apple-style cross-site `form_post` cookie behavior requires distinct hostnames
(e.g. `127.0.0.1` vs `localhost`); dedicate one Playwright case to it.

### 5. Setup command tests

Snapshot the `--oauth` template output, following the webAuthn precedent in
`packages/auth-providers/dbAuth/setup/src/__tests__`. Additionally — with no
existing precedent to copy — test idempotency: running setup twice must not
mangle `auth.ts` or the schema (the failure mode of the community plugin's
manual-surgery setup).

### 6. Scheduled provider-contract job (catches "provider X changed their API")

Cedar's code touches four machine-facing provider surfaces — discovery/JWKS, the
authorization endpoint URL, the token endpoint, and the profile endpoint — and
all four can be exercised with plain HTTP calls: no browser, no bot detection,
no consent screens. A cron workflow (nightly or weekly, **not** per-PR, so a
provider outage never blocks merges) runs three tiers:

- **Tier 1 — zero credentials (all presets + strategies):** fetch discovery
  documents and JWKS and assert the endpoints/algorithms the presets rely on;
  probe the authorization endpoint (a dummy client id yields a recognizable
  "invalid client" response, distinguishable from "endpoint moved"); POST a
  bogus code to the token endpoint and assert the documented error shape
  (GitHub's `error: bad_verification_code`, Facebook's `error.type` structure —
  Graph API version sunsets surface here).
- **Tier 2 — app credentials only (one registered OAuth app per shipped
  provider — a dedicated app with minimum scopes, holding no production data —
  secrets set once):** the same token-endpoint probe with real client
  auth, proving the authentication format is still accepted. For Apple this
  validates the whole ES256 client-secret contraption: a correct client
  assertion + bogus code must yield `invalid_grant`, not `invalid_client`.
- **Tier 3 — real API calls with non-interactive tokens:** contract-test the msw
  fixtures against live responses so drift fails with a diff naming the fixture
  and strategy to update.
  - _Facebook (if ever promoted to built-in):_ app-scoped **test users** are
    created and issued access tokens programmatically via the app API — call
    `/me?fields=id,name,email` with a real token.
  - _GitHub:_ OAuth user tokens don't expire by default; mint one once, store as
    a secret, call `/user` + the email endpoint.
  - _Google:_ mint a refresh token once via a local bootstrap script (with the
    OAuth app in production status the refresh token is long-lived); CI runs the
    real refresh → userinfo flow and pushes the fresh id_token through the
    actual oauth4webapi verification path.
  - _Apple:_ no non-interactive Apple ID auth exists, so Apple tops out at Tier
    2 — one of the reasons Apple is not in the launch scope.

Operational shape: a failure opens a GitHub issue; the release process checks
that the latest contract run is green. Bootstrap is once per provider (register
app, run the token-mint script), with a documented re-bootstrap command for the
rare token death. The one surface left uncovered is the provider's human-facing
consent UI — not Cedar code, and a breakage there is the provider breaking their
own UI, which their other integrators surface within hours.

## Open questions

- Which additional OIDC presets to ship as named data presets (candidates from
  the threads: Keycloak, Auth0, GitLab, Azure AD) vs. documenting them as plain
  issuer configuration. Presets are data, so this is a docs/DX question, not an
  implementation question.
- Where do provider access/refresh tokens live (identity-table columns vs.
  discard after login)? Storing them creates a secrets-retention surface; the
  old how-to stored them, the plugin stores neither. Default should be
  discard-after-login unless a use case demands otherwise.
- Account-linking UX for email collisions (provider email matches an existing
  password account): auto-link vs. require explicit confirmation. The community
  plugin deliberately does _not_ auto-create/link on collision; decide
  explicitly. Auto-linking on unverified provider emails is an account takeover
  vector — if auto-link is offered, gate it on `email_verified`.

## Sources

- [Cedar OAuth how-to](https://cedarjs.com/docs/how-to/oauth/)
- [spoonjoy/redwoodjs-dbauth-oauth](https://github.com/spoonjoy/redwoodjs-dbauth-oauth)
  ([api README](https://github.com/spoonjoy/redwoodjs-dbauth-oauth/blob/main/api/README.md),
  [web README](https://github.com/spoonjoy/redwoodjs-dbauth-oauth/blob/main/web/README.md))
- [Irev-Dev's dbAuth SSO PoC PR — contains Rob's and DT's key comments](https://github.com/Irev-Dev/redwood/pull/45)
- [Pure social authentication thread — DT's slippery-slope comment](https://community.redwoodjs.com/t/pure-social-authentication/2644)
- [Combining dbAuth + OAuth2 thread](https://community.redwoodjs.com/t/combining-dbauth-oauth2/2452)
- [Extending dbAuth with SSO thread](https://community.redwoodjs.com/t/extending-dbauth-with-sso/2598)
- [oauth4webapi](https://github.com/panva/oauth4webapi)
- ["I am deprecating most of my open-source NPM packages" — Arctic/Lucia author's deprecation post, July 29, 2026](https://pilcrowonpaper.com/blog/18)
- [Arctic v3.7.0 provider sources (frozen reference code)](https://github.com/pilcrowOnPaper/arctic/tree/v3.7.0/src/providers)
