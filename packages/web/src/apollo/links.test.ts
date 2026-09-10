import { gql } from '@apollo/client'
import { describe, expect, it } from 'vitest'

import { getOperationKind } from './links.js'

describe('getOperationKind', () => {
  it('returns the selected operation type instead of the document kind', () => {
    const document = gql`
      query GetUser {
        user {
          id
        }
      }

      mutation UpdateUser {
        updateUser {
          id
        }
      }
    `

    expect(getOperationKind(document, 'GetUser')).toBe('query')
    expect(getOperationKind(document, 'UpdateUser')).toBe('mutation')
  })
})
