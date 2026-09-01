import type { APIGatewayProxyEvent, Context as LambdaContext } from 'aws-lambda'

import type { CorsContext, PartialRequest } from '@cedarjs/api'
import { createCorsContext } from '@cedarjs/api'
import {
  createExpiresAtDate,
  createLoginResponse,
  dbAuthSession,
  extractCookie,
  getDbAuthResponseBuilder,
} from '@cedarjs/auth-dbauth-api'

import {
  CannotUnlinkLastIdentityError,
  EmailInUseError,
  FlowNotEnabledError,
  ForbiddenError,
  IdentityInUseError,
  NotAuthenticatedError,
  OAuthError,
  UnknownIdentityError,
  UnknownProviderError,
} from './errors.js'
import type { OAuthErrorCode } from './errors.js'
import { resolveIdentityFields, IdentityModel } from './identity.js'
import {
  normalizeOAuthRequest,
  parseAuthorizeFlow,
  parseOAuthRoute,
} from './request.js'
import type { NormalizedOAuthRequest } from './request.js'
import {
  clearTransactionCookieString,
  createTransactionCookieString,
  decodeTransactionCookie,
  DEFAULT_TRANSACTION_EXPIRES_SECONDS,
  getTransactionCookieValue,
  isTransactionExpired,
} from './transactionCookie.js'
import type { OAuthHandlerOptions, OAuthUserInfo, UserType } from './types.js'

type HandlerResult = {
  body?: string
  statusCode: number
  headers: Headers
}

function appendQueryParams(
  path: string,
  params: Record<string, string>,
): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${new URLSearchParams(params).toString()}`
}

/**
 * Handles the redirect-based OAuth flow (`login`/`signup`/`link`/`unlink`)
 * for dbAuth, under its own base path (`/auth/oauth` by default) rather
 * than `DbAuthHandler`'s `METHODS`/`VERBS` dispatch table — see the
 * "Endpoint shape" decision in the implementation plan.
 *
 * Constructed per-request, the same way `DbAuthHandler` is, and accepts
 * both a Lambda-style event and a Fetch `Request` so it works from a
 * function handler and from `@cedarjs/auth-dbauth-middleware`.
 */
export class OAuthHandler<TDb extends object = Record<string, unknown>> {
  event: Request | APIGatewayProxyEvent
  options: OAuthHandlerOptions<TDb>
  basePath: string
  corsContext: CorsContext | undefined
  createResponse: ReturnType<typeof getDbAuthResponseBuilder>
  identities: IdentityModel
  userAccessor: any
  _normalizedRequest: NormalizedOAuthRequest | undefined

  constructor(
    event: APIGatewayProxyEvent | Request,
    _context: LambdaContext,
    options: OAuthHandlerOptions<TDb>,
  ) {
    this.event = event
    this.options = options
    this.basePath = options.basePath ?? '/auth/oauth'
    this.createResponse = getDbAuthResponseBuilder(event)

    if (options.cors) {
      this.corsContext = createCorsContext(options.cors)
    }

    this.userAccessor = options.db[options.authModelAccessor]
    this.identities = new IdentityModel(
      options.db[options.oauthModelAccessor],
      resolveIdentityFields(options.oauthFields),
    )
  }

  get normalizedRequest(): NormalizedOAuthRequest {
    if (!this._normalizedRequest) {
      throw new Error(
        'OAuthHandler has not been initialized. Either await ' +
          'oauthHandler.invoke() or call await oauthHandler.init().',
      )
    }
    return this._normalizedRequest
  }

  async init() {
    this._normalizedRequest ??= await normalizeOAuthRequest(this.event)
  }

  async invoke() {
    let corsHeaders = {}
    await this.init()

    if (this.corsContext) {
      // `createCorsContext`'s helpers only read `method`/`headers`, but are
      // typed against the full `PartialRequest` (which also carries
      // `jsonBody`) used elsewhere in `@cedarjs/api` — pad it out rather
      // than changing `NormalizedOAuthRequest`'s shape for callers that
      // don't need a parsed JSON body at all (form_post callbacks aren't
      // JSON).
      const corsRequest: PartialRequest = {
        ...this.normalizedRequest,
        jsonBody: {},
      }
      corsHeaders = this.corsContext.getRequestHeaders(corsRequest)
      if (this.corsContext.shouldHandleCors(corsRequest)) {
        return this.createResponse({ body: '', statusCode: 200 }, corsHeaders)
      }
    }

    const route = parseOAuthRoute(this.normalizedRequest.path, this.basePath)

    if (!route) {
      return this.createResponse(this._notFound(), corsHeaders)
    }

    const { method } = this.normalizedRequest

    if (route.action === 'authorize') {
      if (method !== 'GET') {
        return this.createResponse(this._notFound(), corsHeaders)
      }
      return this.createResponse(
        await this._authorize(route.provider),
        corsHeaders,
      )
    }

    if (route.action === 'callback') {
      if (method !== 'GET' && method !== 'POST') {
        return this.createResponse(this._notFound(), corsHeaders)
      }
      return this.createResponse(
        await this._callback(route.provider),
        corsHeaders,
      )
    }

    if (method !== 'POST') {
      return this.createResponse(this._notFound(), corsHeaders)
    }
    return this.createResponse(await this._unlink(route.provider), corsHeaders)
  }

  /**
   * Cookie config for the transaction cookie: `transactionCookie` when set,
   * otherwise falls back to `cookie` (the same config the session cookie
   * uses).
   */
  private get _transactionCookieConfig() {
    return this.options.transactionCookie ?? this.options.cookie
  }

  // -- authorize --------------------------------------------------------

  private async _authorize(providerKey: string): Promise<HandlerResult> {
    const strategy = this.options.providers[providerKey]

    if (!strategy) {
      return this._redirectWithError('unknown_provider', providerKey)
    }

    const flow = parseAuthorizeFlow(this.normalizedRequest.query)

    if (flow === 'signup' && this.options.signup.enabled === false) {
      return this._redirectWithError('flow_not_enabled', providerKey)
    }

    if (flow === 'link') {
      const session = dbAuthSession(this.event, this.options.cookie?.name)
      if (!session) {
        return this._redirectWithError('not_authenticated', providerKey)
      }
    }

    try {
      const oauth = await import('oauth4webapi')

      const state = oauth.generateRandomState()
      const codeVerifier = oauth.generateRandomCodeVerifier()
      const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier)
      const nonce = strategy.usesOidc ? oauth.generateRandomNonce() : undefined

      const authorizationUrl = await strategy.getAuthorizationUrl({
        provider: providerKey,
        redirectUri: strategy.redirectUri,
        flow,
        state,
        codeVerifier,
        codeChallenge,
        nonce,
      })

      const transactionExpires =
        this.options.transactionExpires ?? DEFAULT_TRANSACTION_EXPIRES_SECONDS

      const headers = new Headers()
      headers.set('Location', authorizationUrl.toString())
      headers.append(
        'set-cookie',
        createTransactionCookieString({
          data: {
            provider: providerKey,
            flow,
            state,
            codeVerifier,
            nonce,
            createdAt: Date.now(),
          },
          cookieConfig: this._transactionCookieConfig,
          expiresSeconds: transactionExpires,
        }),
      )

      return { body: '', statusCode: 302, headers }
    } catch (e) {
      return this._handleUnexpectedError(e, providerKey)
    }
  }

  // -- callback -----------------------------------------------------------

  private async _callback(providerKey: string): Promise<HandlerResult> {
    const clearCookieHeaders = new Headers()
    clearCookieHeaders.append(
      'set-cookie',
      clearTransactionCookieString(this._transactionCookieConfig),
    )

    const cookieHeader = extractCookie(this.event)
    const txn = decodeTransactionCookie(getTransactionCookieValue(cookieHeader))
    const transactionExpires =
      this.options.transactionExpires ?? DEFAULT_TRANSACTION_EXPIRES_SECONDS

    if (!txn || txn?.provider !== providerKey) {
      return this._redirectWithError(
        'invalid_state',
        providerKey,
        clearCookieHeaders,
      )
    }

    if (isTransactionExpired(txn, transactionExpires)) {
      return this._redirectWithError(
        'invalid_state',
        providerKey,
        clearCookieHeaders,
      )
    }

    const strategy = this.options.providers[providerKey]
    if (!strategy) {
      return this._redirectWithError(
        'unknown_provider',
        providerKey,
        clearCookieHeaders,
      )
    }

    const { query, form } = this.normalizedRequest

    if (query.error ?? form.error) {
      return this._redirectWithError(
        'provider_error',
        providerKey,
        clearCookieHeaders,
      )
    }

    const state = query.state ?? form.state
    if (!state || state !== txn.state) {
      return this._redirectWithError(
        'invalid_state',
        providerKey,
        clearCookieHeaders,
      )
    }

    let profile: OAuthUserInfo
    try {
      profile = await strategy.handleCallback({
        provider: providerKey,
        redirectUri: strategy.redirectUri,
        flow: txn.flow,
        state: txn.state,
        codeVerifier: txn.codeVerifier,
        nonce: txn.nonce,
        query,
        form,
      })
    } catch (e) {
      return this._handleUnexpectedError(e, providerKey, clearCookieHeaders)
    }

    try {
      let result: HandlerResult

      if (txn.flow === 'login') {
        result = await this._handleLogin(providerKey, profile)
      } else if (txn.flow === 'signup') {
        result = await this._handleSignup(providerKey, profile)
      } else {
        result = await this._handleLink(providerKey, profile)
      }

      result.headers.append(
        'set-cookie',
        clearTransactionCookieString(this._transactionCookieConfig),
      )
      return result
    } catch (e) {
      if (e instanceof OAuthError) {
        return this._redirectWithError(e.code, providerKey, clearCookieHeaders)
      }
      return this._handleUnexpectedError(e, providerKey, clearCookieHeaders)
    }
  }

  private async _handleLogin(
    providerKey: string,
    profile: OAuthUserInfo,
  ): Promise<HandlerResult> {
    const identity = await this.identities.findByProviderUserId(
      providerKey,
      profile.providerUserId,
    )
    if (!identity) {
      throw new UnknownIdentityError(providerKey)
    }

    const user = await this._findUserById(this.identities.userIdOf(identity))
    if (!user) {
      throw new UnknownIdentityError(providerKey)
    }

    return this._loginRedirect(user, this.options.redirects.afterLogin)
  }

  private async _handleSignup(
    providerKey: string,
    profile: OAuthUserInfo,
  ): Promise<HandlerResult> {
    if (this.options.signup.enabled === false) {
      throw new FlowNotEnabledError()
    }

    // Already linked: signing up again is really a login, not a duplicate
    // account attempt.
    const existingIdentity = await this.identities.findByProviderUserId(
      providerKey,
      profile.providerUserId,
    )
    if (existingIdentity) {
      const user = await this._findUserById(
        this.identities.userIdOf(existingIdentity),
      )
      if (user) {
        return this._loginRedirect(user, this.options.redirects.afterLogin)
      }
    }

    if (profile.email) {
      const existingUser = await this.userAccessor.findFirst({
        where: { [this.options.authFields.username]: profile.email },
      })
      if (existingUser) {
        throw new EmailInUseError()
      }
    }

    const signup = this.options.signup
    if (!('handler' in signup)) {
      throw new FlowNotEnabledError()
    }

    const user = await signup.handler({ provider: providerKey, profile })
    const userId = user[this.options.authFields.id]
    await this.identities.create(userId, providerKey, profile)

    return this._loginRedirect(
      user,
      this.options.redirects.afterSignup ?? this.options.redirects.afterLogin,
    )
  }

  private async _handleLink(
    providerKey: string,
    profile: OAuthUserInfo,
  ): Promise<HandlerResult> {
    const session = dbAuthSession(this.event, this.options.cookie?.name)
    if (!session) {
      throw new NotAuthenticatedError()
    }
    const userId = session[this.options.authFields.id]

    const existingIdentity = await this.identities.findByProviderUserId(
      providerKey,
      profile.providerUserId,
    )

    if (existingIdentity) {
      const existingUserId = this.identities.userIdOf(existingIdentity)
      if (existingUserId !== userId) {
        throw new IdentityInUseError()
      }
      // Already linked to this same account — idempotent success.
    } else {
      await this.identities.create(userId, providerKey, profile)
    }

    const headers = new Headers()
    headers.set(
      'Location',
      this.options.redirects.afterLink ?? this.options.redirects.afterLogin,
    )
    return { body: '', statusCode: 302, headers }
  }

  private _loginRedirect(user: UserType, redirectTo: string): HandlerResult {
    const expiresAt = createExpiresAtDate(this.options.sessionExpires)
    const [, headers] = createLoginResponse(user, {
      cookie: this.options.cookie,
      allowedUserFields: this.options.allowedUserFields,
      expiresAt,
    })

    headers.set('Location', redirectTo)
    return { body: '', statusCode: 302, headers }
  }

  private async _findUserById(userId: unknown): Promise<UserType | null> {
    const user = await this.userAccessor.findFirst({
      where: { [this.options.authFields.id]: userId },
    })
    return user ?? null
  }

  // -- unlink ---------------------------------------------------------------

  private async _unlink(providerKey: string): Promise<HandlerResult> {
    try {
      // Forced-preflight CSRF defense: a cross-site HTML form can POST to
      // this endpoint using only the session cookie, but it cannot set a
      // custom header. A cross-origin `fetch` that sets one triggers a CORS
      // preflight this endpoint doesn't approve, so requiring the header
      // restricts this route to same-origin JavaScript callers.
      if (!this.normalizedRequest.headers.get('x-oauth-action')) {
        throw new ForbiddenError()
      }

      const session = dbAuthSession(this.event, this.options.cookie?.name)
      if (!session) {
        throw new NotAuthenticatedError()
      }
      const userId = session[this.options.authFields.id]

      if (!this.options.providers[providerKey]) {
        throw new UnknownProviderError(providerKey)
      }

      const identity = await this.identities.findByUserAndProvider(
        userId,
        providerKey,
      )
      if (!identity) {
        return this._json({ error: 'unknown_identity' }, 404)
      }

      const user = await this._findUserById(userId)
      const hasPassword = Boolean(
        user?.[this.options.authFields.hashedPassword],
      )

      if (!hasPassword) {
        const allIdentities = await this.identities.findAllForUser(userId)
        if (allIdentities.length <= 1) {
          throw new CannotUnlinkLastIdentityError()
        }
      }

      await this.identities.delete(userId, providerKey)

      if (!hasPassword) {
        // The guard above is advisory under concurrency: two simultaneous
        // unlink requests from a passwordless user with exactly two
        // identities can each observe two identities, both pass the guard,
        // and both delete, leaving the account with zero login methods.
        // Re-check the count after this delete and restore the row just
        // removed if a concurrent unlink already took the account to zero.
        const remaining = await this.identities.findAllForUser(userId)
        if (remaining.length === 0) {
          await this.identities.create(
            userId,
            providerKey,
            this.identities.profileOf(identity),
          )
          throw new CannotUnlinkLastIdentityError()
        }
      }

      return this._json({ ok: true }, 200)
    } catch (e) {
      if (e instanceof OAuthError) {
        return this._json({ error: e.code }, this._statusForError(e.code))
      }

      const message = e instanceof Error ? e.message : String(e)
      console.error('[@cedarjs/auth-dbauth-oauth] unlink failed:', message)
      return this._json({ error: 'server_error' }, 500)
    }
  }

  private _statusForError(code: OAuthErrorCode): number {
    switch (code) {
      case 'not_authenticated':
        return 401
      case 'forbidden':
        return 403
      case 'unknown_provider':
        return 404
      default:
        return 400
    }
  }

  // -- response helpers -------------------------------------------------

  private _json(
    data: Record<string, unknown>,
    statusCode: number,
  ): HandlerResult {
    return {
      body: JSON.stringify(data),
      statusCode,
      headers: new Headers({ 'content-type': 'application/json' }),
    }
  }

  private _notFound(): HandlerResult {
    return this._json({ error: 'not_found' }, 404)
  }

  private _redirectWithError(
    code: OAuthErrorCode,
    providerKey: string,
    extraHeaders?: Headers,
  ): HandlerResult {
    const headers = extraHeaders ? new Headers(extraHeaders) : new Headers()
    headers.set(
      'Location',
      appendQueryParams(this.options.redirects.error, {
        error: code,
        provider: providerKey,
      }),
    )
    return { body: '', statusCode: 302, headers }
  }

  private _handleUnexpectedError(
    e: unknown,
    providerKey: string,
    extraHeaders?: Headers,
  ): HandlerResult {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[@cedarjs/auth-dbauth-oauth]', message)

    const code: OAuthErrorCode =
      e instanceof OAuthError ? e.code : 'server_error'
    return this._redirectWithError(code, providerKey, extraHeaders)
  }
}
