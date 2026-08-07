import { describe, expect, it } from 'vitest'

import { buildCedarContext, wrapLegacyHandler } from '@cedarjs/api/runtime'

import { useRequireAuth } from '../useRequireAuth.js'

import { getCurrentUser } from './fixtures/auth.js'

const authDecoder = async (token: string, type: string) => {
  if (type !== 'custom') {
    return null
  }

  return { sub: 'user-1', token }
}

const myHandler = async () => {
  const globalContext = (await import('@cedarjs/context')).context

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentUser: globalContext.currentUser ?? 'NO_CURRENT_USER',
    }),
  }
}

// This is exactly what a user's `export const handler = useRequireAuth({...})`
// becomes once `lambdaLoader` wraps it via `wrapLegacyHandler`.
const cedarHandler = wrapLegacyHandler(
  useRequireAuth({ handlerFn: myHandler, getCurrentUser, authDecoder }),
)

async function invoke(headers: Record<string, string>) {
  const request = new Request('http://localhost:8911/myHandler', {
    method: 'POST',
    body: '',
    headers,
  })

  const ctx = await buildCedarContext(request, {
    params: { routeName: 'myHandler' },
  })

  const response = await cedarHandler(request, ctx)

  return { status: response.status, body: await response.json() }
}

describe('useRequireAuth through the fetch-native path', () => {
  it('still populates currentUser from a Bearer token', async () => {
    const result = await invoke({
      'auth-provider': 'custom',
      authorization: 'Bearer auth-test-token',
    })

    expect(result.status).toBe(200)
    expect(result.body.currentUser).toMatchObject({ sub: 'user-1' })
  })

  it('does not 500 when auth-provider is sent without an Authorization header', async () => {
    const result = await invoke({ 'auth-provider': 'custom' })

    expect(result.status).toBe(200)
    expect(result.body.currentUser).toBe('NO_CURRENT_USER')
  })

  it('does not 500 when the API key is sent with no auth scheme', async () => {
    const result = await invoke({
      'auth-provider': 'custom',
      authorization: 'rawapikey',
    })

    expect(result.status).toBe(200)
    expect(result.body.currentUser).toBe('NO_CURRENT_USER')
  })
})
