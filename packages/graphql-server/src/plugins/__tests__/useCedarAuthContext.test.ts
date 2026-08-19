import { describe, expect, it, vi } from 'vitest'

import type { AuthContextPayload, Decoder } from '@cedarjs/api'

import { useCedarAuthContext } from '../useCedarAuthContext.js'

const authDecoder: Decoder = async (token: string) => ({ token })

const MOCK_AUTH_CONTEXT_PAYLOAD: AuthContextPayload = [
  { sub: '1', email: 'ba@zin.ga' },
  {
    type: 'mocked-auth-type',
    schema: 'mocked-schema-bearer',
    token: 'mocked-undecoded-token',
  },
  { event: new Request('http://localhost/mock'), context: undefined },
]

/**
 * Auth state is resolved when the request enters Cedar, so what this plugin
 * gets handed is an already-built GraphQL context, with Cedar's own request
 * context on it as `cedarContext`.
 */
function createMockGraphQLContext(
  authContextPayload: AuthContextPayload | undefined,
) {
  return {
    params: {},
    request: new Request('http://localhost/graphql'),
    waitUntil: () => undefined,
    requestContext: undefined,
    cedarContext: {
      params: {},
      query: new URLSearchParams(),
      cookies: new Map<string, string>(),
      serverAuthState: authContextPayload,
    },
  }
}

const contextWithoutCedarContext = {
  params: {},
  request: new Request('http://localhost/graphql'),
  waitUntil: () => undefined,
  requestContext: undefined,
}

describe('useCedarAuthContext', () => {
  it('updates context with output of current user', async () => {
    const mockUser = {
      id: 'my-user-id',
      name: 'Mockity MockFace',
    }

    const mockedGetCurrentUser = vi.fn().mockResolvedValue(mockUser)
    const plugin = useCedarAuthContext(mockedGetCurrentUser, authDecoder)
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    const extendContext = vi.fn()

    await onContextBuilding({
      context: createMockGraphQLContext(MOCK_AUTH_CONTEXT_PAYLOAD),
      extendContext,
      breakContextBuilding() {
        return undefined
      },
    })

    expect(mockedGetCurrentUser).toHaveBeenCalledWith(
      { email: 'ba@zin.ga', sub: '1' },
      {
        schema: 'mocked-schema-bearer',
        token: 'mocked-undecoded-token',
        type: 'mocked-auth-type',
      },
      MOCK_AUTH_CONTEXT_PAYLOAD[2],
    )

    expect(extendContext).toHaveBeenCalledWith({
      currentUser: mockUser,
    })
  })

  it('does not swallow exceptions raised in getCurrentUser', async () => {
    const mockedGetCurrentUser = vi
      .fn()
      .mockRejectedValue(new Error('Could not fetch user from db.'))

    const plugin = useCedarAuthContext(mockedGetCurrentUser, authDecoder)
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    const extendContext = vi.fn()

    await expect(
      onContextBuilding({
        context: createMockGraphQLContext(MOCK_AUTH_CONTEXT_PAYLOAD),
        extendContext,
        breakContextBuilding() {
          return undefined
        },
      }),
    ).rejects.toEqual(
      new Error('Exception in getCurrentUser: Could not fetch user from db.'),
    )

    expect(mockedGetCurrentUser).toHaveBeenCalled()
    expect(extendContext).not.toHaveBeenCalled()
  })

  it('leaves the request unauthenticated when there is no auth state', async () => {
    const mockedGetCurrentUser = vi.fn()
    const plugin = useCedarAuthContext(mockedGetCurrentUser, authDecoder)
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    const extendContext = vi.fn()

    await onContextBuilding({
      context: createMockGraphQLContext(undefined),
      extendContext,
      breakContextBuilding() {
        return undefined
      },
    })

    expect(mockedGetCurrentUser).not.toHaveBeenCalled()
    expect(extendContext).not.toHaveBeenCalled()
  })

  // An entry point that doesn't build a context would otherwise serve every
  // request as unauthenticated, with nothing to show for it
  it('throws when no cedarContext was built and auth is configured', async () => {
    const plugin = useCedarAuthContext(vi.fn(), authDecoder)
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    await expect(
      onContextBuilding({
        context: contextWithoutCedarContext,
        extendContext: vi.fn(),
        breakContextBuilding() {
          return undefined
        },
      }),
    ).rejects.toThrow(/no `cedarContext`/)
  })

  // `buildCedarContext` treats an empty decoder array as no auth configured,
  // so this guard has to agree — otherwise it throws on a setup that never had
  // auth state to resolve in the first place
  it('does not throw without a cedarContext for an empty decoder array', async () => {
    const plugin = useCedarAuthContext(vi.fn(), [])
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    const extendContext = vi.fn()

    await onContextBuilding({
      context: contextWithoutCedarContext,
      extendContext,
      breakContextBuilding() {
        return undefined
      },
    })

    expect(extendContext).not.toHaveBeenCalled()
  })

  it('does not throw without a cedarContext when auth is not configured', async () => {
    const plugin = useCedarAuthContext(undefined)
    const onContextBuilding = plugin.onContextBuilding

    if (!onContextBuilding) {
      throw new Error('Expected onContextBuilding hook to be defined')
    }

    const extendContext = vi.fn()

    await onContextBuilding({
      context: contextWithoutCedarContext,
      extendContext,
      breakContextBuilding() {
        return undefined
      },
    })

    expect(extendContext).not.toHaveBeenCalled()
  })
})
