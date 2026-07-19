import React from 'react'

import type { GraphQLFormattedError } from 'graphql'

export interface ServerParseError extends Error {
  response: Response
  statusCode: number
  bodyText: string
}

export interface ServerError extends Error {
  response: Response
  statusCode: number
  result: Record<string, any>
}

export interface RWGqlError {
  message: string
  /**
   * GraphQL errors as exposed by Apollo Client 4's `CombinedGraphQLErrors`
   */
  errors?: readonly GraphQLFormattedError[]
  /**
   * GraphQL errors in the Apollo Client 3 shape. Kept so tests, Storybook
   * mocks and other GraphQL clients that use this shape keep working
   */
  graphQLErrors?: readonly GraphQLFormattedError[]
  networkError?: Error | ServerParseError | ServerError | null
}

export type RwGqlErrorProperties = Record<string, Record<string, string[]>>

interface FormErrorProps {
  error?: RWGqlError
  wrapperClassName?: string
  wrapperStyle?: React.CSSProperties
  titleClassName?: string
  titleStyle?: React.CSSProperties
  listClassName?: string
  listStyle?: React.CSSProperties
  listItemClassName?: string
  listItemStyle?: React.CSSProperties
}

/**
 * Big error message at the top of the page explaining everything that's wrong
 * with the form fields in this form
 */
const FormError = ({
  error,
  wrapperClassName,
  wrapperStyle,
  titleClassName,
  titleStyle,
  listClassName,
  listStyle,
  listItemClassName,
  listItemStyle,
}: FormErrorProps) => {
  if (!error) {
    return null
  }

  let rootMessage = error.message
  const messages: string[] = []
  const graphQLErrors = error.graphQLErrors?.length
    ? error.graphQLErrors
    : (error.errors ?? [])
  const hasGraphQLError = !!graphQLErrors[0]
  // Apollo Client 4 no longer wraps network errors in a `networkError`
  // property – the error itself is the server error
  const networkError =
    error.networkError ??
    ('bodyText' in error || 'result' in error
      ? // `RWGqlError` is a loose interface over what GraphQL clients throw;
        // when the object has server-error fields the error itself is the
        // network error
        (error as unknown as ServerParseError | ServerError)
      : null)
  const hasNetworkError = !!networkError && Object.keys(networkError).length > 0

  if (hasGraphQLError) {
    rootMessage = graphQLErrors[0].message ?? 'Something went wrong'

    // override top-level message for ServiceValidation errorrs
    if (graphQLErrors[0]?.extensions?.code === 'BAD_USER_INPUT') {
      rootMessage = 'Errors prevented this form from being saved'
    }

    const properties = graphQLErrors[0].extensions?.[
      'properties'
    ] as RwGqlErrorProperties

    const propertyMessages = properties?.['messages']

    if (propertyMessages) {
      for (const e in propertyMessages) {
        propertyMessages[e].forEach((fieldError: any) => {
          messages.push(fieldError)
        })
      }
    }
  } else if (hasNetworkError) {
    rootMessage = rootMessage ?? 'An error has occurred'
    if ('bodyText' in networkError) {
      const netErr = networkError as ServerParseError
      messages.push(`${netErr.name}: ${netErr.bodyText}`)
    } else if ('result' in networkError) {
      const netErr = networkError as ServerError
      netErr.result.errors?.forEach((error: any) => {
        if (typeof error.message === 'string') {
          if (error.message.indexOf(';') >= 0) {
            messages.push(error.message?.split(';')[1])
          } else {
            messages.push(error.message)
          }
        }
      })
    }
  }

  if (!rootMessage) {
    return null
  }

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <p className={titleClassName} style={titleStyle}>
        {rootMessage}
      </p>
      {messages.length > 0 && (
        <ul className={listClassName} style={listStyle}>
          {messages.map((message: string, index: number) => (
            <li key={index} className={listItemClassName} style={listItemStyle}>
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default FormError
