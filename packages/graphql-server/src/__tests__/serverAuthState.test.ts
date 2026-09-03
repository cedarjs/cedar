import { describe, expect, it, vi } from 'vitest'

import { resolveServerAuthState } from '../serverAuthState.js'

const getCurrentUser = vi.fn()

function authenticatedRequest() {
  return new Request('http://localhost:8911/graphql', {
    headers: {
      'auth-provider': 'custom-auth',
      authorization: 'Bearer opaque-token',
    },
  })
}

describe('resolveServerAuthState', () => {
  it('resolves nothing when there is no getCurrentUser to resolve for', async () => {
    // Without a `getCurrentUser` nothing reads the auth state, and the
    // malformed `Authorization` header here would throw if it were parsed
    const request = new Request('http://localhost:8911/graphql', {
      headers: {
        'auth-provider': 'custom-auth',
        authorization: 'no-schema',
      },
    })

    await expect(
      resolveServerAuthState({ authDecoder: undefined }, request),
    ).resolves.toBeUndefined()
  })

  it('resolves nothing for an unauthenticated request', async () => {
    const request = new Request('http://localhost:8911/graphql')

    await expect(
      resolveServerAuthState({ getCurrentUser }, request),
    ).resolves.toBeUndefined()
  })

  // Opaque tokens can't be decoded locally, so a project validates the raw
  // token in `getCurrentUser` instead of configuring a decoder
  it('hands getCurrentUser the raw token when there is no decoder', async () => {
    const authState = await resolveServerAuthState(
      { getCurrentUser },
      authenticatedRequest(),
    )

    expect(authState?.[0]).toBeNull()
    expect(authState?.[1]).toEqual({
      type: 'custom-auth',
      schema: 'Bearer',
      token: 'opaque-token',
    })
  })

  it('treats an empty decoder array the same as no decoder', async () => {
    const authState = await resolveServerAuthState(
      { getCurrentUser, authDecoder: [] },
      authenticatedRequest(),
    )

    expect(authState?.[0]).toBeNull()
    expect(authState?.[1].token).toBe('opaque-token')
  })

  it('runs the decoder when there is one', async () => {
    const authDecoder = vi.fn(async (token: string, type: string) => ({
      token,
      type,
    }))

    const authState = await resolveServerAuthState(
      { getCurrentUser, authDecoder },
      authenticatedRequest(),
    )

    expect(authDecoder).toHaveBeenCalledTimes(1)
    expect(authState?.[0]).toEqual({
      token: 'opaque-token',
      type: 'custom-auth',
    })
  })
})
