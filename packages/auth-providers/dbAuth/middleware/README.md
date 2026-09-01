# DbAuth Middleware

### Example instantiation

```tsx filename='entry.server.tsx'
import type { TagDescriptor } from '@cedarjs/web'

import App from './App'
import initDbAuthMiddleware from '@cedarjs/auth-dbauth-middleware'
import { Document } from './Document'

import { handler as dbAuthHandler } from '$api/src/functions/auth'
import { cookieName } from '$api/src/lib/auth'
import { getCurrentUser } from '$api/src/lib/auth'
interface Props {
  css: string[]
  meta?: TagDescriptor[]
}

export const registerMiddleware = () => {
  // This actually returns [dbAuthMiddleware, '*']
  const authMw = initDbAuthMiddleware({
    dbAuthHandler,
    getCurrentUser,
    // cookieName optional
    // getRoles optional
    // dbAuthUrl? optional
  })

  return [authMw]
}

export const ServerEntry: React.FC<Props> = ({ css, meta }) => {
  return (
    <Document css={css} meta={meta}>
      <App />
    </Document>
  )
}
```

### OAuth routing

Apps using [`@cedarjs/auth-dbauth-oauth`](../oauth) opt in by also passing an `oauthHandler`, built the same way `dbAuthHandler` is — by wrapping `OAuthHandler`'s `invoke()`:

```tsx
import { OAuthHandler } from '@cedarjs/auth-dbauth-oauth'

import { handler as dbAuthHandler } from '$api/src/functions/auth'
import { oauthOptions } from '$api/src/lib/auth'

const authMw = initDbAuthMiddleware({
  dbAuthHandler,
  getCurrentUser,
  oauthHandler: (req, context) =>
    new OAuthHandler(req, context, oauthOptions).invoke(),
  // oauthUrl? optional, defaults to '/auth/oauth' (OAuthHandlerOptions.basePath's default)
})
```

Requests whose URL falls under `oauthUrl` (`authorize`/`callback`/`unlink`) are dispatched to `oauthHandler` instead of the normal dbAuth session-validation path; its 302 redirects, `Set-Cookie` headers (session, `auth-provider`, and the OAuth transaction cookie), and JSON bodies are carried over to the middleware response unchanged. Omitting `oauthHandler` entirely disables OAuth routing — requests under `oauthUrl` fall through to the normal dbAuth handling, exactly as if the option didn't exist.

### Roles handling

By default the middleware assumes your roles will be in `currentUser.roles` - either as a string or an array of strings.

For example

```js

// If this is your current user:
{
  email: 'user-1@example.com',
  id: 'mocked-current-user-1',
  roles: 'admin'
}

// In the ServerAuthState
{
  cookieHeader: 'session=session_cookie',
  currentUser: {
    email: 'user-1@example.com',
    id: 'mocked-current-user-1',
    roles: 'admin' // <-- you sent back 'admin' as string
  },
  hasError: false,
  isAuthenticated: true,
  loading: false,
  userMetadata: /*..*/
  roles: ['admin'] // <-- converted to array
}
```

You can customise this by passing a custom `getRoles` function into `initDbAuthMiddleware`. For example:

```ts
const authMw = initDbAuthMiddleware({
  dbAuthHandler,
  getCurrentUser,
  getRoles: (decoded) => {
    // Assuming you want to get roles from a property called org
    if (decoded.currentUser.org) {
      return [decoded.currentUser.org]
    } else {
      return []
    }
  },
})
```
