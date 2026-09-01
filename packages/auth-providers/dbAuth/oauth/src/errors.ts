/**
 * Stable, documented error codes surfaced to the browser via the `error`
 * query param on the configured error-redirect (or in the JSON body for the
 * `unlink` flow, which never redirects). Exception text is never leaked to
 * the client — only one of these codes is.
 */
export type OAuthErrorCode =
  | 'unknown_provider'
  | 'invalid_state'
  | 'provider_error'
  | 'unknown_identity'
  | 'email_in_use'
  | 'identity_in_use'
  | 'not_authenticated'
  | 'flow_not_enabled'
  | 'cannot_unlink_last_identity'
  | 'server_error'

/**
 * Base class for every error the OAuth handler throws. `code` is the stable
 * identifier written to the error-redirect/JSON response; `message` is for
 * server-side logs only and is never sent to the client.
 */
export class OAuthError extends Error {
  code: OAuthErrorCode

  constructor(code: OAuthErrorCode, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

export class UnknownProviderError extends OAuthError {
  constructor(provider: string) {
    super('unknown_provider', `No OAuth provider configured for '${provider}'`)
    this.name = 'UnknownProviderError'
  }
}

export class InvalidStateError extends OAuthError {
  constructor(
    message = 'OAuth transaction cookie is missing, expired, or state does not match',
  ) {
    super('invalid_state', message)
    this.name = 'InvalidStateError'
  }
}

export class ProviderError extends OAuthError {
  constructor(message: string) {
    super('provider_error', message)
    this.name = 'ProviderError'
  }
}

export class UnknownIdentityError extends OAuthError {
  constructor(provider: string) {
    super(
      'unknown_identity',
      `No account is linked to this ${provider} identity`,
    )
    this.name = 'UnknownIdentityError'
  }
}

export class EmailInUseError extends OAuthError {
  constructor(message = 'An account already exists with this email address') {
    super('email_in_use', message)
    this.name = 'EmailInUseError'
  }
}

export class IdentityInUseError extends OAuthError {
  constructor(message = 'This identity is already linked to another account') {
    super('identity_in_use', message)
    this.name = 'IdentityInUseError'
  }
}

export class NotAuthenticatedError extends OAuthError {
  constructor(message = 'You must be logged in to link or unlink an account') {
    super('not_authenticated', message)
    this.name = 'NotAuthenticatedError'
  }
}

export class FlowNotEnabledError extends OAuthError {
  constructor(message = 'This OAuth flow is not enabled') {
    super('flow_not_enabled', message)
    this.name = 'FlowNotEnabledError'
  }
}

export class CannotUnlinkLastIdentityError extends OAuthError {
  constructor(
    message = 'Cannot unlink the last identity from an account with no password set',
  ) {
    super('cannot_unlink_last_identity', message)
    this.name = 'CannotUnlinkLastIdentityError'
  }
}
