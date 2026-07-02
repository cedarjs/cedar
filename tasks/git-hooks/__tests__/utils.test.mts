import { describe, it, expect } from 'vitest'

import { sanitizeArg, buildWindowsCommand } from '../utils.mts'

describe('sanitizeArg', () => {
  it('wraps a plain string in double quotes', () => {
    expect(sanitizeArg('hello.ts')).toBe('"hello.ts"')
  })

  it('escapes double quotes with double-double quotes', () => {
    expect(sanitizeArg('hello"world.ts')).toBe('"hello""world.ts"')
  })

  it('passes percent signs through (no reliable escape in cmd.exe inline mode)', () => {
    expect(sanitizeArg('%USERNAME%.ts')).toBe('"%USERNAME%.ts"')
  })

  it('handles a path with spaces', () => {
    expect(sanitizeArg('hello world.ts')).toBe('"hello world.ts"')
  })

  it('handles mixed escaping', () => {
    expect(sanitizeArg('"hello" %world%.ts')).toBe('"""hello"" %world%.ts"')
  })
})

describe('buildWindowsCommand', () => {
  it('builds a command string with all args sanitized', () => {
    expect(
      buildWindowsCommand('yarn', ['prettier', '--write', 'file.ts']),
    ).toBe('yarn "prettier" "--write" "file.ts"')
  })

  it('sanitizes args with spaces', () => {
    expect(buildWindowsCommand('yarn', ['prettier', 'hello world.ts'])).toBe(
      'yarn "prettier" "hello world.ts"',
    )
  })

  it('passes percent signs through', () => {
    expect(buildWindowsCommand('yarn', ['prettier', '%TEMP%.ts'])).toBe(
      'yarn "prettier" "%TEMP%.ts"',
    )
  })
})
