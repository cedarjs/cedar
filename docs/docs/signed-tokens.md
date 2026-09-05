---
description:
  Mint and verify short-lived, tamper-proof tokens for OAuth state, signed
  links, and more
---

# Signed Tokens

A signed token is a short, URL-safe string that carries a few claims, expires,
and provably came from your application. Your api side hands it out, it travels
through an untrusted place (a query string, an email, a third-party redirect),
and when it comes back you can trust what's inside it without having stored
anything.

Typical uses:

- **OAuth `state`.** The callback from Google or GitHub is a plain function
  receiving a redirect, with no session to check a nonce against. A signed token
  in `state` carries the nonce _and_ tells the callback which user or
  organization started the flow.
- **Email links.** Confirmation, password-set, magic-login, and unsubscribe
  links all need "a URL that provably came from us, says who it is for, and
  stops working after a while."
- **Capability tokens.** A token that lets a client do one specific thing for a
  few minutes, such as upload a file into one specific bucket.

`@cedarjs/api` exports two functions for this, `createSignedToken` and
`verifySignedToken`, plus a `SignedTokenError` that verification throws whenever
a token cannot be trusted.

## Setup

Tokens are signed with a secret. Generate one and put it in your api side's
`.env` file as `SIGNED_TOKEN_SECRET`:

```bash
yarn cedar generate secret
```

```bash title=".env"
SIGNED_TOKEN_SECRET=...the generated value...
```

Do not check this file into version control, and use a different value in each
environment. Use a separate secret from `SESSION_SECRET` so the two can be
rotated independently.

Both functions also accept a `secret` option, which takes precedence over the
environment variable. There is no built-in fallback secret: if neither is set,
both functions throw a `SignedTokenError` with code `MISSING_SECRET` rather than
signing with a guessable value.

## Creating a token

```ts
import { createSignedToken } from '@cedarjs/api'

const state = createSignedToken({
  payload: { organizationId, userId },
  purpose: 'google-oauth-state',
  expiresIn: '10m',
})
```

| Option      | Description                                                                                                                                                                                                                              |
| :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload`   | The claims to carry. Any JSON-serializable object. Values that are not JSON, such as a `Date`, come back as whatever `JSON.stringify` turns them into.                                                                                   |
| `purpose`   | Required. What the token is for, like `'google-oauth-state'` or `'email-confirmation'`. Verification only succeeds with the same purpose, so a token minted for one flow cannot be replayed in another. Pick a distinct string per flow. |
| `expiresIn` | Required. How long the token stays valid. A number is a count of seconds; a string is a duration such as `'10m'`, `'2h'`, or `'7 days'`. Keep it as short as the flow allows.                                                            |
| `secret`    | Optional. Overrides `SIGNED_TOKEN_SECRET`.                                                                                                                                                                                               |

The result is a standard JSON Web Token signed with HS256, so it is URL-safe
as-is and can be inspected with any JWT debugger. The payload is not encrypted,
only signed: anyone holding the token can read the claims, they just cannot
change them. Don't put secrets in the payload.

## Verifying a token

```ts
import { verifySignedToken } from '@cedarjs/api'

const { organizationId, userId } = verifySignedToken<{
  organizationId: string
  userId: string
}>(event.queryStringParameters?.state, { purpose: 'google-oauth-state' })
```

`verifySignedToken` returns the payload exactly as it was passed to
`createSignedToken`. The type parameter tells TypeScript what shape to expect;
the framework cannot check it at runtime, so treat it the way you would treat
any value your own code serialized earlier.

Anything that stops the token from being trusted throws a `SignedTokenError`. It
never returns `null` or `false`, so forgetting to check the result cannot let a
bad token through. The token argument accepts `undefined` and `null` on purpose:
pass the raw query-string or header value straight in, and a missing token is a
verification failure like any other.

| Option    | Description                                                  |
| :-------- | :----------------------------------------------------------- |
| `purpose` | Required. Must match the purpose the token was created with. |
| `secret`  | Optional. Overrides `SIGNED_TOKEN_SECRET`.                   |

### Handling failures

`SignedTokenError` has a `code` property so you can tell the cases apart, for
instance to show "this link has expired, request a new one" instead of a generic
error:

| Code               | Meaning                                                                                                               |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `MISSING_TOKEN`    | The token argument was `undefined`, `null`, or an empty string.                                                       |
| `EXPIRED`          | The token was valid but its `expiresIn` has passed.                                                                   |
| `INVALID`          | The token is malformed, was signed with a different secret, has been tampered with, or was not created by Cedar.      |
| `PURPOSE_MISMATCH` | The token was created for a different `purpose`. The message names both purposes.                                     |
| `MISSING_PURPOSE`  | `purpose` was not passed or was empty. This is a programming error, not a bad token.                                  |
| `MISSING_SECRET`   | No `secret` option and no `SIGNED_TOKEN_SECRET` environment variable. This is a configuration error, not a bad token. |
| `SIGN_FAILED`      | Thrown by `createSignedToken` when the token could not be produced, such as an unparseable `expiresIn`.               |

```ts
import { SignedTokenError, verifySignedToken } from '@cedarjs/api'

try {
  const { userId } = verifySignedToken<{ userId: string }>(token, {
    purpose: 'email-confirmation',
  })
  await confirmEmail(userId)
} catch (e) {
  if (e instanceof SignedTokenError && e.code === 'EXPIRED') {
    return { statusCode: 410, body: 'This link has expired.' }
  }

  throw e
}
```

Only `EXPIRED` is usually worth a specific message to the user. The other codes
are either a tampered or foreign token, which deserves a generic rejection, or a
mistake in your own code or configuration, which should surface as an error
during development.

## Example: OAuth state without a session store

A function that starts an OAuth flow with a third-party calendar API puts a
signed token in the `state` parameter. The callback verifies it and learns which
organization to attach the integration to from the token itself, rather than
from any ambient context.

```ts title="api/src/functions/calendarConnect.ts"
import type { APIGatewayProxyEvent } from 'aws-lambda'

import { createSignedToken } from '@cedarjs/api'
import { authDecoder } from '@cedarjs/auth-dbauth-api'
import { context } from '@cedarjs/context'
import { useRequireAuth } from '@cedarjs/graphql-server'

import { getCurrentUser, requireAuth } from 'src/lib/auth'

const calendarConnect = async (_event: APIGatewayProxyEvent) => {
  // `useRequireAuth` below populates `context.currentUser` for this function
  requireAuth()

  const state = createSignedToken({
    payload: {
      organizationId: context.currentUser.organizationId,
      userId: context.currentUser.id,
    },
    purpose: 'calendar-oauth-state',
    expiresIn: '10m',
  })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  url.searchParams.set(
    'redirect_uri',
    `${process.env.API_URL}/calendarCallback`
  )
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar')
  url.searchParams.set('state', state)

  return { statusCode: 302, headers: { Location: url.toString() } }
}

export const handler = useRequireAuth({
  handlerFn: calendarConnect,
  getCurrentUser,
  authDecoder,
})
```

```ts title="api/src/functions/calendarCallback.ts"
import type { APIGatewayProxyEvent } from 'aws-lambda'

import { SignedTokenError, verifySignedToken } from '@cedarjs/api'

import { db } from 'src/lib/db'

interface CalendarOAuthState {
  organizationId: string
  userId: string
}

export const handler = async (event: APIGatewayProxyEvent) => {
  let state: CalendarOAuthState

  try {
    state = verifySignedToken<CalendarOAuthState>(
      event.queryStringParameters?.state,
      { purpose: 'calendar-oauth-state' }
    )
  } catch (e) {
    if (e instanceof SignedTokenError) {
      return { statusCode: 400, body: 'Invalid or expired OAuth state.' }
    }

    throw e
  }

  const tokens = await exchangeCodeForTokens(event.queryStringParameters?.code)

  await db.integration.upsert({
    where: { organizationId: state.organizationId },
    create: { organizationId: state.organizationId, ...tokens },
    update: tokens,
  })

  return { statusCode: 302, headers: { Location: '/settings/integrations' } }
}
```

Because the organization comes from the verified token and nowhere else, the
callback works the same whether or not any user session is present, and a forged
or expired `state` is rejected before any database write.

Verification is stateless: a valid token is accepted every time it is presented
until it expires. When a flow must be single-use, record the token when it is
consumed (for example by storing the `state` value on the row it creates) and
refuse a second callback that carries the same one.

## Design notes

These are the properties the helper guarantees so that you don't have to think
about them at each call site:

- **Purpose binding is mandatory.** There is no way to mint a token without a
  purpose, and no way to verify one without naming the purpose you expect. One
  secret can safely serve every flow in the app.
- **Expiry is mandatory and always enforced.** A token with no `exp` claim is
  rejected even when its signature is valid.
- **Fails closed.** A missing secret, a missing token, or a missing purpose all
  throw. Nothing is skipped because a value happened to be absent.
- **Only HS256 is accepted on verification.** A token whose header names another
  algorithm, including `none`, is rejected before its signature is compared,
  which closes the algorithm-confusion class of JWT bugs.
- **Signatures are compared in constant time.**

## Testing

In tests, set `SIGNED_TOKEN_SECRET` like any other environment variable, and use
fake timers to exercise expiry:

```ts
import { createSignedToken, verifySignedToken } from '@cedarjs/api'

test('rejects an expired confirmation link', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

  const token = createSignedToken({
    payload: { userId: '1' },
    purpose: 'email-confirmation',
    expiresIn: '1h',
  })

  vi.setSystemTime(new Date('2026-01-01T02:00:00Z'))

  expect(() =>
    verifySignedToken(token, { purpose: 'email-confirmation' })
  ).toThrow('expired')

  vi.useRealTimers()
})
```
