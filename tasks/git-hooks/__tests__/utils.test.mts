import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { buildWindowsCommand } from '../utils.mts'

describe('buildWindowsCommand', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    // In Vitest 4, vi.spyOn returns the existing spy (with its call history)
    // when the method is already spied on, so restore between tests to avoid
    // call counts leaking from one test into the next.
    vi.restoreAllMocks()
  })

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

  it('skips args with percent signs and warns', () => {
    const result = buildWindowsCommand('yarn', ['prettier', '%TEMP%.ts'])
    expect(result).toBe('yarn "prettier"')
    expect(console.warn).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('%TEMP%.ts'),
    )
  })

  it('skips all args if all contain percent signs', () => {
    const result = buildWindowsCommand('yarn', ['%A%', '%B%'])
    expect(result).toBe('yarn')
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
})
