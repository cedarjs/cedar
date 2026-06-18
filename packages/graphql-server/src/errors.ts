// based on ApolloError https://github.com/apollographql/apollo-server/blob/main/packages/apollo-server-errors/src/index.ts
import { GraphQLError } from 'graphql'

export class CedarGraphQLError extends GraphQLError {
  constructor(
    message: string,
    extensions?: Record<string, any>,
    originalError?: Error & {
      readonly extensions?: unknown
    },
  ) {
    super(message, {
      extensions: {
        ...extensions,
        code: extensions?.code || 'REDWOODJS_ERROR',
      },
      originalError,
    })

    Object.setPrototypeOf(this, GraphQLError.prototype)
  }
}

/** @deprecated Use `CedarGraphQLError` instead */
export const RedwoodGraphQLError = CedarGraphQLError

// Exporting as const (like we do above) puts RedwoodGraphQLError only in
// TypeScript's value namespace, not the type namespace. Any caller who used the
// old class as a type annotation (e.g., function handle(error:
// RedwoodGraphQLError)) will now get a compile error: 'RedwoodGraphQLError'
// refers to a value, but is being used as a type here. An instanceof guard and
// new still work, but the type annotation form is a real backward-compat break.
// A parallel type export makes both namespaces available.
/** @deprecated Use `CedarGraphQLError` instead */
export type RedwoodGraphQLError = CedarGraphQLError

export class SyntaxError extends CedarGraphQLError {
  constructor(message: string) {
    super(message, { code: 'GRAPHQL_PARSE_FAILED' })

    Object.setPrototypeOf(this, SyntaxError.prototype)
  }
}

export class ValidationError extends CedarGraphQLError {
  constructor(message: string) {
    super(message, { code: 'GRAPHQL_VALIDATION_FAILED' })

    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

export class AuthenticationError extends CedarGraphQLError {
  constructor(message: string) {
    super(message, { code: 'UNAUTHENTICATED' })

    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

export class ForbiddenError extends CedarGraphQLError {
  constructor(message: string) {
    super(message, { code: 'FORBIDDEN' })

    Object.setPrototypeOf(this, ForbiddenError.prototype)
  }
}

export class PersistedQueryNotFoundError extends CedarGraphQLError {
  constructor() {
    super('PersistedQueryNotFound', { code: 'PERSISTED_QUERY_NOT_FOUND' })

    Object.setPrototypeOf(this, PersistedQueryNotFoundError.prototype)
  }
}

export class PersistedQueryNotSupportedError extends CedarGraphQLError {
  constructor() {
    super('PersistedQueryNotSupported', {
      code: 'PERSISTED_QUERY_NOT_SUPPORTED',
    })

    Object.setPrototypeOf(this, PersistedQueryNotSupportedError.prototype)
  }
}

export class UserInputError extends CedarGraphQLError {
  constructor(message: string, properties?: Record<string, any>) {
    super(message, { code: 'BAD_USER_INPUT', properties })

    Object.setPrototypeOf(this, UserInputError.prototype)
  }
}
