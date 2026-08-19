import { describe, expect, it } from 'vitest'

import { hasApolloState } from '../apolloState.js'

describe('hasApolloState', () => {
  it('is false for an empty extracted state', () => {
    expect(hasApolloState({})).toBe(false)
  })

  it('is true for a populated extracted state', () => {
    expect(hasApolloState({ 'Query:root': { __typename: 'Query' } })).toBe(true)
  })
})
