import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'

import { githubProvider } from '../strategies/github'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function strategy() {
  return githubProvider({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://example.com/auth/oauth/github/callback',
  })
}

describe('githubProvider', () => {
  it('builds an authorization URL with state and PKCE', () => {
    const url = strategy().getAuthorizationUrl({
      provider: 'github',
      redirectUri: 'https://example.com/auth/oauth/github/callback',
      flow: 'login',
      state: 'the-state',
      codeVerifier: 'the-verifier',
      codeChallenge: 'the-challenge',
      nonce: undefined,
    }) as URL

    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    )
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.com/auth/oauth/github/callback',
    )
    expect(url.searchParams.get('state')).toBe('the-state')
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('maps a profile with a public email', async () => {
    server.use(
      http.post(
        'https://github.com/login/oauth/access_token',
        async ({ request }) => {
          expect(request.headers.get('accept')).toBe('application/json')
          return HttpResponse.json({
            access_token: 'gho_test_token',
            token_type: 'bearer',
            scope: 'read:user,user:email',
          })
        },
      ),
      http.get('https://api.github.com/user', ({ request }) => {
        expect(request.headers.get('authorization')).toBe(
          'Bearer gho_test_token',
        )
        return HttpResponse.json({
          id: 123,
          login: 'octocat',
          email: 'octocat@github.com',
        })
      }),
    )

    const profile = await strategy().handleCallback({
      provider: 'github',
      redirectUri: 'https://example.com/auth/oauth/github/callback',
      flow: 'login',
      state: 'the-state',
      codeVerifier: 'the-verifier',
      nonce: undefined,
      query: { code: 'the-code', state: 'the-state' },
      form: {},
    })

    expect(profile.providerUserId).toBe('123')
    expect(profile.email).toBe('octocat@github.com')
    expect(profile.username).toBe('octocat')
  })

  it('falls back to /user/emails and picks the primary verified address when email is null', async () => {
    server.use(
      http.post('https://github.com/login/oauth/access_token', () =>
        HttpResponse.json({
          access_token: 'gho_test_token',
          token_type: 'bearer',
        }),
      ),
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ id: 456, login: 'privateuser', email: null }),
      ),
      http.get('https://api.github.com/user/emails', () =>
        HttpResponse.json([
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'unverified@example.com', primary: false, verified: false },
          { email: 'primary@example.com', primary: true, verified: true },
        ]),
      ),
    )

    const profile = await strategy().handleCallback({
      provider: 'github',
      redirectUri: 'https://example.com/auth/oauth/github/callback',
      flow: 'login',
      state: 'the-state',
      codeVerifier: 'the-verifier',
      nonce: undefined,
      query: { code: 'the-code', state: 'the-state' },
      form: {},
    })

    expect(profile.providerUserId).toBe('456')
    expect(profile.email).toBe('primary@example.com')
    expect(profile.emailVerified).toBe(true)
  })

  it('leaves email undefined when no verified primary email is available', async () => {
    server.use(
      http.post('https://github.com/login/oauth/access_token', () =>
        HttpResponse.json({
          access_token: 'gho_test_token',
          token_type: 'bearer',
        }),
      ),
      http.get('https://api.github.com/user', () =>
        HttpResponse.json({ id: 789, login: 'noemail', email: null }),
      ),
      http.get('https://api.github.com/user/emails', () =>
        HttpResponse.json([
          { email: 'unverified@example.com', primary: true, verified: false },
        ]),
      ),
    )

    const profile = await strategy().handleCallback({
      provider: 'github',
      redirectUri: 'https://example.com/auth/oauth/github/callback',
      flow: 'login',
      state: 'the-state',
      codeVerifier: 'the-verifier',
      nonce: undefined,
      query: { code: 'the-code', state: 'the-state' },
      form: {},
    })

    expect(profile.email).toBeUndefined()
  })
})
