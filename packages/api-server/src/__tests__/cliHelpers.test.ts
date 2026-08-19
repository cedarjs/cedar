import path from 'path'

import {
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
} from 'vitest'

import { getConfig } from '@cedarjs/project-config'

import {
  getAPIHost,
  getAPIPort,
  getWebHost,
  getWebPort,
} from '../cliHelpers.js'

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.join(__dirname, './fixtures/graphql/cedar-app')
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

beforeEach(() => {
  vi.unstubAllEnvs()
})

describe('getAPIPort', () => {
  it('falls back to [api].port in cedar.toml', () => {
    expect(getAPIPort()).toBe(getConfig().api.port)
  })

  it('prefers CEDAR_API_PORT over cedar.toml', () => {
    vi.stubEnv('CEDAR_API_PORT', '8920')

    expect(getAPIPort()).toBe(8920)
  })

  it('ignores PORT when the api side is not public', () => {
    vi.stubEnv('PORT', '8080')

    expect(getAPIPort()).toBe(getConfig().api.port)
  })

  it('uses PORT when the api side is public', () => {
    vi.stubEnv('PORT', '8080')

    expect(getAPIPort({ isPublicSide: true })).toBe(8080)
  })

  it('prefers CEDAR_API_PORT over PORT', () => {
    vi.stubEnv('CEDAR_API_PORT', '8920')
    vi.stubEnv('PORT', '8080')

    expect(getAPIPort({ isPublicSide: true })).toBe(8920)
  })

  it('throws on a non-integer PORT', () => {
    vi.stubEnv('PORT', 'eight-oh-eight-oh')

    expect(() =>
      getAPIPort({ isPublicSide: true }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid PORT env var value: "eight-oh-eight-oh". Must be an integer.]`,
    )
  })

  // These parse as 8080 and 1 with a bare `parseInt`, which would bind a port
  // nobody asked for and leave the deployment unreachable
  it('throws on a PORT with a numeric prefix', () => {
    vi.stubEnv('PORT', '8080abc')

    expect(() =>
      getAPIPort({ isPublicSide: true }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid PORT env var value: "8080abc". Must be an integer.]`,
    )
  })

  it('throws on a decimal PORT', () => {
    vi.stubEnv('PORT', '1.5')

    expect(() =>
      getAPIPort({ isPublicSide: true }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid PORT env var value: "1.5". Must be an integer.]`,
    )
  })

  it('throws on a CEDAR_API_PORT with a numeric prefix', () => {
    vi.stubEnv('CEDAR_API_PORT', '8920nope')

    expect(() => getAPIPort()).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid CEDAR_API_PORT env var value: "8920nope". Must be an integer.]`,
    )
  })
})

describe('getWebPort', () => {
  it('falls back to [web].port in cedar.toml', () => {
    expect(getWebPort()).toBe(getConfig().web.port)
  })

  it('prefers CEDAR_WEB_PORT over cedar.toml', () => {
    vi.stubEnv('CEDAR_WEB_PORT', '8930')

    expect(getWebPort()).toBe(8930)
  })

  it('ignores PORT when the web side is not public', () => {
    vi.stubEnv('PORT', '8080')

    expect(getWebPort()).toBe(getConfig().web.port)
  })

  it('uses PORT when the web side is public', () => {
    vi.stubEnv('PORT', '8080')

    expect(getWebPort({ isPublicSide: true })).toBe(8080)
  })
})

describe('both sides in one process', () => {
  // Regression test: `cedar serve` runs both servers in one process, so only
  // the public side (web) may take PORT. If both did they'd collide.
  it('does not give the same port to both sides', () => {
    vi.stubEnv('PORT', '8080')

    expect(getWebPort({ isPublicSide: true })).toBe(8080)
    expect(getAPIPort()).not.toBe(8080)
  })
})

describe('host helpers', () => {
  it('ignores HOST when the side is not public', () => {
    vi.stubEnv('HOST', '10.0.0.1')

    expect(getAPIHost()).not.toBe('10.0.0.1')
    expect(getWebHost()).not.toBe('10.0.0.1')
  })

  it('uses HOST when the side is public', () => {
    vi.stubEnv('HOST', '10.0.0.1')

    expect(getAPIHost({ isPublicSide: true })).toBe('10.0.0.1')
    expect(getWebHost({ isPublicSide: true })).toBe('10.0.0.1')
  })

  it('prefers CEDAR_API_HOST over HOST', () => {
    vi.stubEnv('CEDAR_API_HOST', '10.0.0.2')
    vi.stubEnv('HOST', '10.0.0.1')

    expect(getAPIHost({ isPublicSide: true })).toBe('10.0.0.2')
  })

  it.each([
    ['development', getAPIHost],
    ['production', getAPIHost],
    ['development', getWebHost],
    ['production', getWebHost],
  ])(
    // `::` binds dual-stack (IPv4 and IPv6), unlike `0.0.0.0` which only binds
    // for IPv4. Same default in both dev and prod
    'falls back to `::` in %s when nothing else is configured',
    (nodeEnv, getHost) => {
      vi.stubEnv('NODE_ENV', nodeEnv)

      expect(getHost()).toBe('::')
    },
  )
})

describe('deprecated REDWOOD_ aliases', () => {
  it.each([
    ['REDWOOD_API_PORT', 'CEDAR_API_PORT', () => getAPIPort(), 8920],
    ['REDWOOD_WEB_PORT', 'CEDAR_WEB_PORT', () => getWebPort(), 8930],
  ])('still reads %s', (deprecatedName, _name, read, expected) => {
    vi.stubEnv(deprecatedName, String(expected))

    expect(read()).toBe(expected)
  })

  it.each([
    ['REDWOOD_API_HOST', () => getAPIHost()],
    ['REDWOOD_WEB_HOST', () => getWebHost()],
  ])('still reads %s', (deprecatedName, read) => {
    vi.stubEnv(deprecatedName, '10.0.0.3')

    expect(read()).toBe('10.0.0.3')
  })

  it('prefers the CEDAR_ name over the deprecated alias', () => {
    vi.stubEnv('CEDAR_API_PORT', '8920')
    vi.stubEnv('REDWOOD_API_PORT', '8921')

    expect(getAPIPort()).toBe(8920)
  })
})
