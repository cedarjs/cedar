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

// @deprecated Use `CedarGraphQLError` instead
export const RedwoodGraphQLError = CedarGraphQLError

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
