import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

import { DbAuthHandler } from '@cedarjs/auth-dbauth-api'
import type { DbAuthHandlerOptions, UserType } from '@cedarjs/auth-dbauth-api'
import { OAuthHandler, createOidcStrategy } from '@cedarjs/auth-dbauth-oauth'
import type { OAuthStrategy } from '@cedarjs/auth-dbauth-oauth'

import { cookieName } from 'src/lib/auth'
import { db } from 'src/lib/db'

// Any request whose path falls under this prefix is routed to the OAuth
// handler instead of the regular username/password dbAuth handler.
const OAUTH_BASE_PATH = '/auth/oauth'

// The origin OAuth callback URLs are registered under: the web dev server's
// `/.api/functions` proxy, not the api dev server's own port directly. A
// callback landing on the api port directly would leave `redirects.afterLogin`
// (a path relative to the app's own origin) resolving against the api
// server's origin instead of the SPA's -- going through the same proxy the
// browser already uses for every other dbAuth request keeps the whole flow
// on one origin.
const apiUrl = `http://localhost:${process.env.WEB_DEV_PORT ?? '8910'}/.api/functions`

const cookieAttributes = {
  HttpOnly: true,
  Path: '/',
  SameSite: 'Lax' as const,
  Secure: false,
}

/**
 * A hand-written `OAuthStrategy` standing in for an Apple-shaped provider:
 * one whose callback arrives as a cross-site `form_post` POST rather than a
 * same-site GET. The dbAuth-oauth smoke suite's own tiny mock provider
 * (started in Playwright global setup on `127.0.0.1`, a different site from
 * this app's `localhost`) plays the provider's part, posting a one-time
 * profile straight into the callback's form body the same way Apple posts a
 * one-time `user` field.
 */
function crossSiteFormPostProvider(): OAuthStrategy {
  const authorizeUrl =
    process.env.OAUTH_CROSSSITE_AUTHORIZE_URL ??
    'http://127.0.0.1:4318/authorize'

  return {
    name: 'Cross-site mock',
    redirectUri: `${apiUrl}/auth/oauth/crosssite/callback`,
    usesOidc: false,
    getAuthorizationUrl: (ctx) => {
      const url = new URL(authorizeUrl)
      url.searchParams.set('redirect_uri', ctx.redirectUri)
      url.searchParams.set('state', ctx.state)
      return url
    },
    handleCallback: async (ctx) => {
      return {
        providerUserId: ctx.form.providerUserId,
        email: ctx.form.email,
      }
    },
  }
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
) => {
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
        // The same-site happy path: a real OIDC provider (`oauth2-mock-server`,
        // started in Playwright global setup on `localhost`) driven through
        // the genuine discovery/PKCE/id_token-verification flow.
        mock: createOidcStrategy(
          {
            name: 'Mock OIDC',
            issuer: process.env.OAUTH_MOCK_ISSUER ?? 'http://localhost:4317',
            scope: 'openid email profile',
          },
          {
            clientId: process.env.OAUTH_MOCK_CLIENT_ID ?? 'mock-client-id',
            clientSecret:
              process.env.OAUTH_MOCK_CLIENT_SECRET ?? 'mock-client-secret',
            redirectUri: `${apiUrl}/auth/oauth/mock/callback`,
            // Only ever set for this local mock issuer -- never for a real
            // provider.
            allowInsecureRequests: true,
          },
        ),
        // The cross-site `form_post` case.
        crosssite: crossSiteFormPostProvider(),
      },
      redirects: {
        afterLogin: '/',
        afterSignup: '/',
        error: '/login',
      },
      signup: {
        handler: ({ profile }) => {
          return db.user.create({
            data: {
              email:
                profile.email ?? `${profile.providerUserId}@oauth.example.com`,
              fullName: profile.username ?? profile.providerUserId,
            },
          })
        },
      },
      sessionExpires: 60 * 60 * 24,
      cookie: {
        attributes: cookieAttributes,
        name: cookieName,
      },
      // The cross-site `form_post` provider's transaction cookie needs
      // `SameSite: 'None'` to survive the browser's cross-site POST back
      // into the callback -- `SameSite: 'Lax'` (the session cookie's
      // policy, from `cookie` above) blocks cookies on cross-site POST
      // navigations. Scoped to the transaction cookie only, via
      // `transactionCookie`, so the session cookie itself keeps the
      // stricter `Lax` policy for every provider, including this one.
      transactionCookie: {
        attributes: { ...cookieAttributes, SameSite: 'None', Secure: true },
        name: cookieName,
      },
    })

    return await oauthHandler.invoke()
  }

  const forgotPasswordOptions: DbAuthHandlerOptions['forgotPassword'] = {
    handler: (user, _resetToken) => {
      return user
    },
    expires: 60 * 60 * 24,
    errors: {
      usernameNotFound: 'Username not found',
      usernameRequired: 'Username is required',
    },
  }

  const loginOptions: DbAuthHandlerOptions['login'] = {
    handler: (user) => {
      return user
    },
    errors: {
      usernameOrPasswordMissing: 'Both username and password are required',
      usernameNotFound: 'Username ${username} not found',
      incorrectPassword: 'Incorrect password for ${username}',
    },
    expires: 60 * 60 * 24 * 365 * 10,
  }

  const resetPasswordOptions: DbAuthHandlerOptions['resetPassword'] = {
    handler: (_user) => {
      return true
    },
    allowReusedPassword: true,
    errors: {
      resetTokenExpired: 'resetToken is expired',
      resetTokenInvalid: 'resetToken is invalid',
      resetTokenRequired: 'resetToken is required',
      reusedPassword: 'Must choose a new password',
    },
  }

  interface UserAttributes {
    'full-name': string
  }

  const signupOptions: DbAuthHandlerOptions<
    UserType,
    UserAttributes
  >['signup'] = {
    handler: ({ username, hashedPassword, salt, userAttributes }) => {
      return db.user.create({
        data: {
          email: username,
          hashedPassword: hashedPassword,
          salt: salt,
          fullName: userAttributes['full-name'],
        },
      })
    },
    passwordValidation: (_password) => {
      return true
    },
    errors: {
      fieldMissing: '${field} is required',
      usernameTaken: 'Username `${username}` already in use',
    },
  }

  const authHandler = new DbAuthHandler(event, context, {
    db,
    authModelAccessor: 'user',
    authFields: {
      id: 'id',
      username: 'email',
      hashedPassword: 'hashedPassword',
      salt: 'salt',
      resetToken: 'resetToken',
      resetTokenExpiresAt: 'resetTokenExpiresAt',
    },
    allowedUserFields: ['id', 'email'],
    cookie: {
      attributes: cookieAttributes,
      name: cookieName,
    },
    forgotPassword: forgotPasswordOptions,
    login: loginOptions,
    resetPassword: resetPasswordOptions,
    signup: signupOptions,
  })

  return await authHandler.invoke()
}
