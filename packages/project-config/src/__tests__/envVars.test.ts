import { describe, expect, it, vi, afterEach } from 'vitest'

import { parsePort, readEnvVar } from '../envVars.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('readEnvVar', () => {
  it('returns undefined when neither name is set', () => {
    expect(
      readEnvVar('CEDAR_THING', { deprecatedAlias: 'REDWOOD_THING' }),
    ).toBe(undefined)
  })

  it('prefers the Cedar name over the deprecated alias', () => {
    vi.stubEnv('CEDAR_THING', 'cedar')
    vi.stubEnv('REDWOOD_THING', 'redwood')

    expect(
      readEnvVar('CEDAR_THING', { deprecatedAlias: 'REDWOOD_THING' }),
    ).toBe('cedar')
  })

  it('falls back to the deprecated alias', () => {
    vi.stubEnv('REDWOOD_THING', 'redwood')

    expect(
      readEnvVar('CEDAR_THING', { deprecatedAlias: 'REDWOOD_THING' }),
    ).toBe('redwood')
  })

  it('treats an empty string as unset', () => {
    vi.stubEnv('CEDAR_THING', '')
    vi.stubEnv('REDWOOD_THING', 'redwood')

    expect(
      readEnvVar('CEDAR_THING', { deprecatedAlias: 'REDWOOD_THING' }),
    ).toBe('redwood')
  })
})

describe('parsePort', () => {
  it('parses a whole number', () => {
    expect(parsePort('8080', 'PORT')).toBe(8080)
  })

  it('ignores surrounding whitespace', () => {
    expect(parsePort(' 8080 ', 'PORT')).toBe(8080)
  })

  it('parses zero', () => {
    expect(parsePort('0', 'PORT')).toBe(0)
  })

  // `parseInt` stops at the first non-digit, so these used to be silently
  // truncated to 8080 and 1 respectively, binding a port nobody asked for.
  it.each([
    ['8080abc', 'a numeric prefix'],
    ['1.5', 'a decimal'],
    ['-1', 'a negative number'],
    ['8080 8081', 'two numbers'],
    ['eight-oh-eight-oh', 'a non-number'],
    ['', 'an empty string'],
    ['   ', 'only whitespace'],
    ['0x1f90', 'a hex literal'],
    ['1e3', 'exponent notation'],
  ])('rejects %j (%s)', (value) => {
    expect(() => parsePort(value, 'PORT')).toThrow(
      `Invalid PORT env var value: "${value}". Must be an integer.`,
    )
  })

  it('names the env var it was given', () => {
    expect(() => parsePort('nope', 'CEDAR_API_PORT')).toThrow(
      'Invalid CEDAR_API_PORT env var value: "nope". Must be an integer.',
    )
  })
})
