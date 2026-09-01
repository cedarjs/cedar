# OAuth

dbAuth ships built-in OAuth login as an opt-in feature: `yarn cedar setup auth dbAuth --oauth google,github` gets you Google and GitHub login, generated buttons on your login/signup pages, and account linking, without touching the username/password flow you already have. This guide walks through setting it up and shows how to add a provider that isn't built in.

If you haven't set up dbAuth yet, start with the [dbAuth docs](../auth/dbauth.md) — everything below assumes dbAuth is already configured.

## What you get

- **Google and GitHub, built in.** Both ship as complete strategies — OIDC discovery and id_token verification for Google, GitHub's OAuth-app-plus-userinfo flow for GitHub.
- **Any OIDC-compliant provider**, via `createOidcStrategy` and an issuer URL — no per-provider code needed for anything that speaks standard OpenID Connect (Keycloak, Auth0, GitLab, Azure AD, ...).
- **A custom-strategy escape hatch** for anything else (Apple, Facebook, or an internal SSO system) — implement the `OAuthStrategy` interface and you're done. Cedar's own Google and GitHub strategies are written against this exact interface, so nothing is off-limits to a userland strategy.
- **Login, signup, link, and unlink**, with guards that stop a user from ever accidentally creating a duplicate account by logging in with a provider they haven't linked yet.
- **PKCE, `state`, and (for OIDC) `nonce` handled for you** for every provider, built on [`oauth4webapi`](https://github.com/panva/oauth4webapi). Provider access/refresh tokens are never persisted.
- **Zero impact on apps that don't opt in.** If you never pass `--oauth`, nothing changes about dbAuth's username/password flow.

## Quickstart

### 1. Run setup

```bash
yarn cedar setup auth dbAuth --oauth google,github
```

This is additive to the regular dbAuth setup: it adds an `OAuth` model to your Prisma schema, makes `hashedPassword`/`salt` on `User` optional (a user can now sign up with just a provider, no password), stubs the provider env vars into `.env`, and adds `@cedarjs/auth-dbauth-oauth` as an api-side dependency.

You can pass either provider on its own (`--oauth google` or `--oauth github`) or both, comma-separated. If you already have dbAuth set up, re-run the command against your existing project — it's safe to run more than once.

### 2. Update the Prisma schema

Setup prints the exact model to add — it looks like this:

```prisma title="api/db/schema.prisma"
model OAuth {
  id               String   @id @default(uuid())
  provider         String
  providerUserId   String
  providerUsername String?
  providerEmail    String?
  userId           String
  user             User     @relation(fields: [userId], references: [id])
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([provider, providerUserId])
  @@unique([userId, provider])
}
```

Add the inverse relation and make the password fields optional on `User`:

```prisma title="api/db/schema.prisma"
model User {
  id                  String    @id @default(uuid())
  email               String    @unique
  // highlight-start
  hashedPassword      String?
  salt                String?
  oauthIdentities     OAuth[]
  // highlight-end
  resetToken          String?
  resetTokenExpiresAt DateTime?
}
```

Then migrate:

```bash
yarn cedar prisma migrate dev
```

Account lookup always keys on `(provider, providerUserId)` — never on email or username — so `providerUserId` is the field that matters for the unique constraint. `providerUsername`/`providerEmail` are just denormalized copies of what the provider returned, useful for display.

### 3. Register OAuth apps with each provider

**Google**

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type "Web application".
2. Add an authorized redirect URI of `${apiUrl}/auth/oauth/google/callback` (e.g. `http://localhost:8911/auth/oauth/google/callback` in dev).
3. Copy the client ID and client secret into `.env`:

```bash title=".env"
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**GitHub**

1. Create an [OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) under your GitHub account or org settings.
2. Set the authorization callback URL to `${apiUrl}/auth/oauth/github/callback`.
3. Copy the client ID and client secret into `.env`:

```bash title=".env"
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

The redirect URI is significant — it must exactly match what's registered with the provider _and_ what's configured in `providers` in your generated `api/src/functions/auth.ts` (see below). Use a distinct OAuth app per environment (dev, staging, production) since each has a different callback host.

### 4. Review the generated auth function

Setup writes (or updates) `api/src/functions/auth.ts` so that any request under `/auth/oauth` is routed to an `OAuthHandler` instead of the regular `DbAuthHandler`:

```ts title="api/src/functions/auth.ts"
import {
  OAuthHandler,
  googleProvider,
  githubProvider,
} from '@cedarjs/auth-dbauth-oauth'

const OAUTH_BASE_PATH = '/auth/oauth'

export const handler = async (event, context) => {
  if (event.path?.includes(OAUTH_BASE_PATH)) {
    const oauthHandler = new OAuthHandler(event, context, {
      db,
      authModelAccessor: 'user',
      oauthModelAccessor: 'oAuth',
      authFields: {
        id: 'id',
        username: 'email',
        hashedPassword: 'hashedPassword',
      },
      basePath: OAUTH_BASE_PATH,
      providers: {
        google: googleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          redirectUri: `${apiUrl}/auth/oauth/google/callback`,
        }),
        github: githubProvider({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          redirectUri: `${apiUrl}/auth/oauth/github/callback`,
        }),
      },
      redirects: {
        afterLogin: '/',
        error: '/login',
      },
      signup: {
        handler: ({ profile }) => {
          return db.user.create({
            data: {
              email: profile.email ?? `${profile.providerUserId}@example.com`,
            },
          })
        },
      },
      sessionExpires: 60 * 60 * 24 * 365 * 10,
      cookie: { attributes: cookieAttributes, name: cookieName },
    })

    return await oauthHandler.invoke()
  }

  // ...regular DbAuthHandler setup below
}
```

The only file you're expected to edit by hand is that `signup.handler` — decide what to do when the provider doesn't return an email (some GitHub accounts keep theirs private), and add any other user fields you want to populate on first sign-in. Everything else — routing, redirect URIs, provider config — is generated so that re-running setup with a different `--oauth` list stays idempotent instead of requiring manual surgery.

Update `apiUrl` at the top of the file (or however you already derive your deployed api URL) once you know your production host — it's used to build every provider's redirect URI.

### 5. Generate login/signup pages (optional)

If you don't already have login/signup pages, or want to regenerate them with OAuth buttons included:

```bash
yarn cedar generate dbAuth
```

The generator detects that `@cedarjs/auth-dbauth-oauth` is installed and includes "Continue with Google" / "Continue with GitHub" buttons automatically. If you already have hand-written pages, see [Generated pages and the web client API](#generated-pages-and-the-web-client-api) below to add the buttons yourself.

## How the flows work

Every provider has to support four distinct account flows, and the whole point of separating them is that a user can never accidentally create a duplicate account:

- **`login`** — the `(provider, providerUserId)` identity must already exist. If nobody has linked this provider identity to an account yet, the flow fails with `unknown_identity` rather than silently creating a new user.
- **`signup`** — creates a new user and a new identity row. If the provider identity is already linked, this behaves like a login instead. If the provider's email matches an existing account's `username` field, it fails with `email_in_use` — the fix is for the user to log in with a password (or another linked provider) and link this provider from there, not to create a second account.
- **`link`** — attaches a provider identity to the account of the currently logged-in dbAuth user. Requires a valid session cookie; fails with `not_authenticated` otherwise. If the identity is already linked to a _different_ account, it fails with `identity_in_use`.
- **`unlink`** — removes a provider identity from the current user's account. Unlike the other three, this is a same-origin JSON `POST`, not a redirect round trip. It refuses to remove the last identity from an account that has no password set (`cannot_unlink_last_identity`) — otherwise the account would become permanently inaccessible. It also requires an `x-oauth-action` request header as a CSRF defense — a cross-site HTML form can't set custom headers, so only same-origin JavaScript (e.g. `unlinkOAuthProvider`) can reach this route; a request without the header fails with `forbidden`.

`login`, `signup`, and `link` are started by navigating the full page to the provider's `authorize` URL (`?flow=login|signup|link`, default `login`) and end with a `302` redirect back into your app — either to `redirects.afterLogin` / `afterSignup` / `afterLink` on success, or to `redirects.error` with `?error=<code>&provider=<name>` appended on failure. `unlink` returns `{ ok: true }` or `{ error: <code> }` directly.

The full set of error codes that can appear on the error redirect (or in the `unlink` JSON body):

| Code                          | Meaning                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown_provider`            | The `{provider}` segment in the URL isn't configured in `providers`.                                                                                          |
| `invalid_state`               | The OAuth transaction cookie is missing, expired, or its `state` doesn't match the callback — a login-CSRF or replay attempt, or the user just took too long. |
| `provider_error`              | The provider returned an `error` parameter to the callback, or the strategy threw during the callback.                                                        |
| `unknown_identity`            | `login` flow, but no account is linked to this provider identity yet.                                                                                         |
| `email_in_use`                | `signup` flow, but the provider's email matches an existing account.                                                                                          |
| `identity_in_use`             | `link` flow, but this provider identity is already linked to a different account.                                                                             |
| `not_authenticated`           | `link` or `unlink` flow, but there's no valid dbAuth session.                                                                                                 |
| `flow_not_enabled`            | `signup` flow, but `signup.enabled` is `false`.                                                                                                               |
| `cannot_unlink_last_identity` | `unlink` flow, but this is the account's last identity and it has no password.                                                                                |
| `forbidden`                   | `unlink` flow, but the request is missing the required `x-oauth-action` header (CSRF defense).                                                                |
| `server_error`                | Anything unexpected — the real error is logged server-side, never sent to the client.                                                                         |

Whatever a strategy throws during `handleCallback` is caught, logged server-side, and turned into `provider_error` (or `server_error` for a non-OAuth exception) — exception text never reaches the browser.

## Generated pages and the web client API

The generated login/signup pages import their OAuth helpers from `@cedarjs/auth-dbauth-web/oauth`:

```tsx title="web/src/pages/LoginPage/LoginPage.tsx"
import { getOAuthUrl, getOAuthError } from '@cedarjs/auth-dbauth-web/oauth'

// Surface an error the OAuth redirect sent back, e.g. after the user
// cancels the provider's consent screen.
useEffect(() => {
  const oauthError = getOAuthError(window.location.search)
  if (oauthError) {
    toast.error('Could not log in: ' + oauthError)
  }
}, [])
```

```tsx
<a href={getOAuthUrl('google', { flow: 'login' })} className="rw-button rw-button-blue">
  Continue with Google
</a>
<a href={getOAuthUrl('github', { flow: 'login' })} className="rw-button rw-button-blue">
  Continue with GitHub
</a>
```

The signup page uses the same buttons with `{ flow: 'signup' }`. These have to be real `<a>` tags navigated as a full page load — the browser needs to actually leave for the provider — not a `fetch`/XHR call.

The web client exports three functions:

- **`getOAuthUrl(provider, options?)`** — builds the absolute `authorize` URL for a provider. `options.flow` defaults to `'login'`; pass `'signup'` or `'link'` as needed.
- **`unlinkOAuthProvider(provider, options?)`** — `POST`s to the `unlink` route with credentials included, and resolves to `{ ok: true }` or `{ error: <code> }`.
- **`getOAuthError(searchParams)`** — extracts and narrows the `?error=<code>` query param from `window.location.search` (or a `URLSearchParams`) after a failed redirect; returns `null` if there's no recognized error code present.

## Using any OIDC-compliant provider

Google and GitHub ship as complete strategies, but every OpenID Connect-compliant provider — Keycloak, Auth0, GitLab, Azure AD, and more — can be added with nothing but an issuer URL, using `createOidcStrategy` from `@cedarjs/auth-dbauth-oauth`. It runs OIDC discovery, the authorization-code + PKCE + nonce flow, and id_token/JWKS verification for you.

Here's Keycloak as an example — add it to the `providers` map in your generated `auth.ts`:

```ts title="api/src/functions/auth.ts"
import { OAuthHandler, createOidcStrategy } from '@cedarjs/auth-dbauth-oauth'

const KEYCLOAK_PRESET = {
  name: 'Keycloak',
  issuer: 'https://keycloak.example.com/realms/my-realm',
  scope: 'openid email profile',
}

// ...inside the `providers` map passed to `new OAuthHandler(event, context, { ... })`:
providers: {
  keycloak: createOidcStrategy(KEYCLOAK_PRESET, {
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    redirectUri: `${apiUrl}/auth/oauth/keycloak/callback`,
  }),
},
```

That's it — the issuer's `/.well-known/openid-configuration` document supplies the authorization and token endpoints and the JWKS Cedar needs to verify the id_token, and the resulting `providerUserId` is the id_token's validated `sub` claim. Register `${apiUrl}/auth/oauth/keycloak/callback` as the redirect URI in the provider's admin console, add a login/signup button with `getOAuthUrl('keycloak', { flow: 'login' })`, and it behaves exactly like Google or GitHub — same flows, same error codes, same session issuance.

`createOidcStrategy` takes a `ProviderPreset` (`{ name, issuer, scope }`) and per-app `credentials` (`{ clientId, clientSecret, redirectUri, scope? }`); the `scope` on `credentials` overrides the preset's default when set.

## Writing a custom strategy

Not every provider speaks OIDC. GitHub's own standard OAuth flow, for instance, issues no id_token — that's why it needs a real (if thin) built-in strategy rather than the OIDC preset path. Anything with the same shape — an OAuth2 authorization-code flow plus a separate userinfo endpoint, with quirky guarantees about what fields are present — is served by writing a small object against the public `OAuthStrategy` interface:

```ts
interface OAuthStrategy {
  name: string
  redirectUri: string
  usesOidc?: boolean
  getAuthorizationUrl(ctx: OAuthAuthorizationContext): Promise<URL> | URL
  handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo>
}
```

`getAuthorizationUrl` builds the URL to redirect the browser to; the handler already generated `state`, PKCE `codeVerifier`/`codeChallenge`, and (for OIDC strategies) `nonce` — your job is just folding them into the URL your provider expects. `handleCallback` completes the token exchange and returns an `OAuthUserInfo` (`{ providerUserId, email?, emailVerified?, username?, raw? }`); throwing aborts the flow with `provider_error`.

Here's a worked example for Facebook — the same OAuth2-plus-userinfo shape as GitHub, using [`oauth4webapi`](https://github.com/panva/oauth4webapi) directly the way Cedar's own strategies do:

```ts
import { OAuthHandler } from '@cedarjs/auth-dbauth-oauth'
import type {
  OAuthAuthorizationContext,
  OAuthCallbackContext,
  OAuthStrategy,
  OAuthUserInfo,
} from '@cedarjs/auth-dbauth-oauth'
import type { AuthorizationServer, Client } from 'oauth4webapi'

const AUTHORIZATION_ENDPOINT = 'https://www.facebook.com/v19.0/dialog/oauth'
const TOKEN_ENDPOINT = 'https://graph.facebook.com/v19.0/oauth/access_token'
const PROFILE_ENDPOINT = 'https://graph.facebook.com/v19.0/me'

function facebookProvider(credentials: {
  clientId: string
  clientSecret: string
  redirectUri: string
}): OAuthStrategy {
  return {
    name: 'Facebook',
    redirectUri: credentials.redirectUri,
    usesOidc: false,

    getAuthorizationUrl(ctx: OAuthAuthorizationContext): URL {
      const url = new URL(AUTHORIZATION_ENDPOINT)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('scope', 'email public_profile')
      url.searchParams.set('state', ctx.state)
      // PKCE support on Facebook's OAuth2 flow is inconsistent, but sending
      // it is harmless when the provider ignores it.
      url.searchParams.set('code_challenge', ctx.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return url
    },

    async handleCallback(ctx: OAuthCallbackContext): Promise<OAuthUserInfo> {
      const oauth = await import('oauth4webapi')

      const as: AuthorizationServer = {
        issuer: 'https://www.facebook.com',
        token_endpoint: TOKEN_ENDPOINT,
      }
      const client: Client = { client_id: credentials.clientId }
      const clientAuth = oauth.ClientSecretPost(credentials.clientSecret)

      const params = oauth.validateAuthResponse(
        as,
        client,
        new URLSearchParams({ ...ctx.query, ...ctx.form }),
        ctx.state
      )

      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        clientAuth,
        params,
        ctx.redirectUri,
        ctx.codeVerifier
      )

      const result = await oauth.processAuthorizationCodeResponse(
        as,
        client,
        response,
        { requireIdToken: false }
      )

      const profileResponse = await fetch(
        `${PROFILE_ENDPOINT}?fields=id,name,email`,
        { headers: { Authorization: `Bearer ${result.access_token}` } }
      )
      const profile = (await profileResponse.json()) as {
        id: string
        name?: string
        email?: string
      }

      return {
        // Facebook's numeric `id` is the only stable field — never key
        // lookup on `email`, which the Graph API omits entirely (not
        // `email: null`) whenever it wasn't granted or isn't on file.
        providerUserId: profile.id,
        email: profile.email,
        username: profile.name,
        raw: profile,
      }
    },
  }
}
```

Add it to `providers` the same way as any built-in strategy, keyed as `facebook` and configured with your client id, client secret, and a redirect URI of `${apiUrl}/auth/oauth/facebook/callback`.

### Apple-shaped providers

Apple's Sign in with Apple needs more than the Facebook example above, and it's the acceptance test for the `OAuthStrategy` interface — every part of it is implementable purely through public fields:

- **A dynamically computed client secret.** Apple's `client_secret` is an ES256-signed JWT with a short expiry that has to be minted per token request, not read out of a static config value. Compute it inside `handleCallback` (with [`jose`](https://github.com/panva/jose), for example) and pass it to `oauth.ClientSecretPost(...)` there — nothing about the interface assumes a static secret.
- **`form_post` callbacks.** Apple POSTs the callback as `application/x-www-form-urlencoded` rather than a `GET` with query params, because it defaults to `response_mode=form_post` whenever scopes are requested. `OAuthCallbackContext.form` carries the parsed form body (`OAuthCallbackContext.query` is empty on a `form_post` callback); read whichever is populated.
- **The one-time `user` form field.** Apple sends the user's name (and sometimes email) as a JSON string in a `user` form field, but only on the very first authorization — never again on subsequent logins, and never in the id_token itself. Read it from `ctx.form.user` in `handleCallback` and treat it as best-effort profile enrichment, since it won't be there on a later login.
- **`SameSite=None` on the session cookie**, since Apple's callback arrives as a cross-site `POST`. Only apps that enable an Apple-shaped provider need this — don't set it globally for a provider that doesn't require it.

## SSR / middleware wiring

Apps using `@cedarjs/auth-dbauth-middleware` (SSR/RSC apps that authenticate through middleware instead of the plain function handler) opt in by also passing an `oauthHandler` to `initDbAuthMiddleware`, built the same way `dbAuthHandler` is — by wrapping `OAuthHandler`'s `invoke()`:

```ts title="web/src/entry.server.tsx"
import { OAuthHandler } from '@cedarjs/auth-dbauth-oauth'
import initDbAuthMiddleware from '@cedarjs/auth-dbauth-middleware'

import { handler as dbAuthHandler } from '$api/src/functions/auth'
import { oauthOptions } from '$api/src/lib/auth'

const authMw = initDbAuthMiddleware({
  dbAuthHandler,
  getCurrentUser,
  oauthHandler: (req, context) =>
    new OAuthHandler(req, context, oauthOptions).invoke(),
  // oauthUrl? optional, defaults to '/auth/oauth'
})
```

Requests under `oauthUrl` (`authorize`/`callback`/`unlink`) are dispatched to `oauthHandler` instead of the normal dbAuth session-validation path — its redirects, `Set-Cookie` headers, and JSON bodies carry through to the middleware response unchanged. Omitting `oauthHandler` disables OAuth routing entirely, exactly as if the option didn't exist.

## Security notes

- **PKCE, `state`, and (for OIDC strategies) `nonce` are generated and validated for every provider**, not just the OIDC ones — `state` is checked against a short-lived, `HttpOnly` transaction cookie on every callback, closing the login-CSRF hole a hand-rolled OAuth integration is most likely to miss.
- **Provider access/refresh tokens are never stored.** The `OAuth` identity table only ever holds `provider`, `providerUserId`, `providerUsername`, and `providerEmail` — once a strategy's `handleCallback` returns the canonical profile, the token it used to fetch it is discarded. This also means the built-in strategies give you authentication only: your app can't call provider APIs on the user's behalf later (say, listing their GitHub repos), because there's no stored token to do it with. If you genuinely need delegated API access, write a [custom strategy](#writing-a-custom-strategy) — it performs the token exchange itself inside `handleCallback`, so it can persist the tokens on its own terms. Storing provider tokens turns your database into a secrets store for other people's accounts, so encrypt them and treat them like passwords.
- **Account lookup always keys on `(provider, providerUserId)`, never on email.** A provider's own numeric/opaque user id is immutable; email addresses (and, for GitHub, usernames) can change or be reused.
- id_token verification (signature, `iss`, `aud`, `exp`, and — when supplied — `nonce`) runs through `oauth4webapi`'s audited implementation for every OIDC-based strategy, including `createOidcStrategy` and Google.
