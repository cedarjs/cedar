import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import {
  buildCookieAttributes,
  createAuthProviderCookieString,
  createCsrfToken,
  createExpiresAtDate,
  createLoginResponse,
  createSessionCookieString,
  sanitizeUser,
} from '../session'
import { decryptSession, getSession } from '../shared'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../../__fixtures__/example-todo-main',
)
const SESSION_SECRET = '540d03ebb00b441f8f7442cbc39958ad'
const UUID_REGEX =
  /\b[0-9a-f]{8}\b-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-\b[0-9a-f]{12}\b/
const UTC_DATE_REGEX = /\w{3}, \d{2} \w{3} \d{4} [\d:]{8} GMT/

// extracts the value for `cookieName` from a single Set-Cookie header string
// (e.g. `session=abcd|efgh;Path=/;Expires=...`)
const getCookieValue = (setCookieString: string, cookieName: string) =>
  getSession(setCookieString, cookieName)

beforeAll(() => {
  process.env.CEDAR_CWD = FIXTURE_PATH
})

afterAll(() => {
  delete process.env.CEDAR_CWD
})

beforeEach(() => {
  process.env.SESSION_SECRET = SESSION_SECRET
})

describe('createExpiresAtDate()', () => {
  it('returns a date in the future as a UTCString', () => {
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + 60 * 60)

    const result = createExpiresAtDate(60 * 60)

    // Avoid flakiness if the test runs right at a second boundary
    if (result !== expiresAt.toUTCString()) {
      expiresAt.setSeconds(expiresAt.getSeconds() - 1)
    }

    expect(result).toEqual(expiresAt.toUTCString())
  })
})

describe('createCsrfToken()', () => {
  it('returns a UUID', () => {
    expect(createCsrfToken()).toMatch(UUID_REGEX)
  })

  it('returns a unique UUID after each call', () => {
    expect(createCsrfToken()).not.toEqual(createCsrfToken())
  })
})

describe('sanitizeUser()', () => {
  it('only keeps the allowed fields', () => {
    const user = {
      id: 1,
      email: 'rob@cedarjs.com',
      hashedPassword: 'shhh',
      salt: 'salty',
    }

    expect(sanitizeUser(user, ['id', 'email'])).toEqual({
      id: 1,
      email: 'rob@cedarjs.com',
    })
  })

  it('does not mutate the original user object', () => {
    const user = { id: 1, hashedPassword: 'shhh' }

    sanitizeUser(user, ['id'])

    expect(user).toEqual({ id: 1, hashedPassword: 'shhh' })
  })
})

describe('buildCookieAttributes()', () => {
  it('returns an array of attributes for the cookie', () => {
    const attributes = buildCookieAttributes({
      cookieConfig: {
        attributes: {
          Path: '/',
          HttpOnly: true,
          SameSite: 'Lax',
          Secure: true,
          Domain: 'example.com',
        },
      },
    })

    expect(attributes.length).toEqual(6)
    expect(attributes[0]).toEqual('Path=/')
    expect(attributes[1]).toEqual('HttpOnly')
    expect(attributes[2]).toEqual('SameSite=Lax')
    expect(attributes[3]).toEqual('Secure')
    expect(attributes[4]).toEqual('Domain=example.com')
    expect(attributes[5]).toMatch('Expires=')
    expect(attributes[5]).toMatch(UTC_DATE_REGEX)
  })

  it('defaults to the past expiration date', () => {
    const attributes = buildCookieAttributes({})

    expect(attributes).toEqual(['Expires=Thu, 01 Jan 1970 00:00:00 GMT'])
  })

  it('uses the given expiration date', () => {
    const attributes = buildCookieAttributes({
      expires: 'Sat, 01 Jan 2050 00:00:00 GMT',
    })

    expect(attributes).toContainEqual('Expires=Sat, 01 Jan 2050 00:00:00 GMT')
  })

  it('includes just a key if option set to `true`', () => {
    const attributes = buildCookieAttributes({
      cookieConfig: { Secure: true },
    })

    expect(attributes[0]).toEqual('Secure')
  })

  it('does not include a key if option set to `false`', () => {
    const attributes = buildCookieAttributes({
      cookieConfig: { Secure: false },
    })

    expect(attributes).not.toContainEqual('Secure')
  })

  it('overrides cookie config attributes with `overrideAttributes`', () => {
    const attributes = buildCookieAttributes({
      cookieConfig: { attributes: { HttpOnly: true } },
      overrideAttributes: { HttpOnly: false },
    })

    expect(attributes).not.toContainEqual('HttpOnly')
  })
})

describe('createAuthProviderCookieString()', () => {
  it('returns a Set-Cookie header string for the auth-provider cookie', () => {
    const cookieString = createAuthProviderCookieString({
      expiresAt: 'Sat, 01 Jan 2050 00:00:00 GMT',
    })

    expect(cookieString).toEqual(
      'auth-provider=dbAuth;Expires=Sat, 01 Jan 2050 00:00:00 GMT',
    )
  })
})

describe('createSessionCookieString()', () => {
  it('returns a Set-Cookie header string that decrypts to `data;csrf`', () => {
    const cookieString = createSessionCookieString({
      data: { id: 1 },
      csrfToken: 'abcd',
      expiresAt: 'Sat, 01 Jan 2050 00:00:00 GMT',
    })

    expect(cookieString).toMatch('Expires=Sat, 01 Jan 2050 00:00:00 GMT')

    const value = getCookieValue(cookieString, 'session')
    const [data, csrfToken] = decryptSession(value)

    expect(data).toEqual({ id: 1 })
    expect(csrfToken).toEqual('abcd')
  })

  it('uses the configured cookie name', () => {
    const cookieString = createSessionCookieString({
      data: { id: 1 },
      csrfToken: 'abcd',
      cookieConfig: { name: 'my_session' },
      expiresAt: 'Sat, 01 Jan 2050 00:00:00 GMT',
    })

    expect(getCookieValue(cookieString, 'my_session')).toBeTruthy()
    expect(getCookieValue(cookieString, 'session')).toBeNull()
  })
})

describe('createLoginResponse()', () => {
  const user = {
    id: 9,
    email: 'rob@cedarjs.com',
    hashedPassword: 'shhh',
    salt: 'salty',
  }

  it('returns the sanitized user as the body', () => {
    const [body] = createLoginResponse(user, { expiresAt: 'now' })

    expect(body).toEqual({ id: 9, email: 'rob@cedarjs.com' })
  })

  it('honors a custom `allowedUserFields` list', () => {
    const [body] = createLoginResponse(user, {
      expiresAt: 'now',
      allowedUserFields: ['id'],
    })

    expect(body).toEqual({ id: 9 })
  })

  it('defaults the status code to 200', () => {
    const [, , { statusCode }] = createLoginResponse(user, {
      expiresAt: 'now',
    })

    expect(statusCode).toEqual(200)
  })

  it('honors a custom status code', () => {
    const [, , { statusCode }] = createLoginResponse(user, {
      expiresAt: 'now',
      statusCode: 201,
    })

    expect(statusCode).toEqual(201)
  })

  it('returns a csrf-token header', () => {
    const [, headers] = createLoginResponse(user, { expiresAt: 'now' })

    expect(headers.get('csrf-token')).toMatch(UUID_REGEX)
  })

  it('sets both the session and auth-provider cookies', () => {
    const [, headers] = createLoginResponse(user, { expiresAt: 'now' })
    const setCookie = headers.getSetCookie()

    expect(setCookie.some((cookie) => cookie.startsWith('session='))).toEqual(
      true,
    )
    expect(
      setCookie.some((cookie) => cookie.startsWith('auth-provider=dbAuth')),
    ).toEqual(true)
  })

  it('pairs the session cookie CSRF token with the csrf-token header', () => {
    const [, headers] = createLoginResponse(user, { expiresAt: 'now' })
    const csrfHeader = headers.get('csrf-token')

    const setCookie = headers.getSetCookie()
    const sessionCookie = setCookie.find((cookie) =>
      cookie.startsWith('session='),
    )
    const [sessionData, csrfFromCookie] = decryptSession(
      getCookieValue(sessionCookie as string, 'session'),
    )

    expect(csrfFromCookie).toEqual(csrfHeader)
    expect(sessionData).toEqual({ id: 9, email: 'rob@cedarjs.com' })
  })

  it('honors cookie config: name and attributes', () => {
    const [, headers] = createLoginResponse(user, {
      expiresAt: 'Sat, 01 Jan 2050 00:00:00 GMT',
      cookie: {
        name: 'my_session',
        attributes: { HttpOnly: true, Secure: true, SameSite: 'Lax' },
      },
    })
    const setCookie = headers.getSetCookie()

    const sessionCookie = setCookie.find((cookie) =>
      cookie.startsWith('my_session='),
    )
    const authProviderCookie = setCookie.find((cookie) =>
      cookie.startsWith('auth-provider=dbAuth'),
    )

    expect(sessionCookie).toBeTruthy()
    expect(sessionCookie).toMatch('HttpOnly')
    expect(sessionCookie).toMatch('Secure')
    expect(sessionCookie).toMatch('SameSite=Lax')
    expect(sessionCookie).toMatch('Expires=Sat, 01 Jan 2050 00:00:00 GMT')

    expect(authProviderCookie).toBeTruthy()
    expect(authProviderCookie).toMatch('HttpOnly')
    expect(authProviderCookie).toMatch('Expires=Sat, 01 Jan 2050 00:00:00 GMT')
  })
})
