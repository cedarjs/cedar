import { vi, describe, it, expect, afterEach } from 'vitest'

// mock Telemetry for CLI commands so they don't try to spawn a process
vi.mock('@cedarjs/telemetry', () => {
  return {
    errorTelemetry: vi.fn(),
    timedTelemetry: () => vi.fn(),
  }
})

import { errorTelemetry } from '@cedarjs/telemetry'

import { requireTTYOrExit } from '../tty.js'

describe('requireTTYOrExit', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY
    vi.restoreAllMocks()
  })

  it('does nothing when stdin is a TTY', () => {
    process.stdin.isTTY = true
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    expect(() => requireTTYOrExit('--foo or --no-foo')).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('prints the given flag hint and exits when stdin is not a TTY', () => {
    process.stdin.isTTY = false
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => requireTTYOrExit('--foo or --no-foo')).toThrow(
      'process.exit called',
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot prompt for confirmation in a non-interactive terminal',
      ),
    )
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--foo or --no-foo'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorTelemetry).toHaveBeenCalled()
  })
})
