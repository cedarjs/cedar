import { describe, it, expect } from 'vitest'

import { escapeArgForWindowsShell } from '../telemetry'

describe('escapeArgForWindowsShell', () => {
  it('quotes a plain argument', () => {
    expect(escapeArgForWindowsShell('--argv')).toEqual('^"--argv^"')
  })

  it('quotes the empty string', () => {
    expect(escapeArgForWindowsShell('')).toEqual('^"^"')
  })

  it('escapes double quotes', () => {
    expect(escapeArgForWindowsShell('say "hi"')).toEqual('^"say^ \\^"hi\\^"^"')
  })

  it('caret-escapes cmd.exe metacharacters so they reach the child process literally', () => {
    for (const char of ['&', '|', '<', '>', '^', '%', '!', '(', ')']) {
      expect(escapeArgForWindowsShell(`a${char}b`)).toEqual(`^"a^${char}b^"`)
    }
  })

  it('does not let injected content break out of the quoted argument', () => {
    // A naive `.join(' ')` would let this terminate the quoted string and
    // run `calc.exe` as a separate command.
    const malicious = '" & calc.exe & "'

    expect(escapeArgForWindowsShell(malicious)).toEqual(
      '^"\\^"^ ^&^ calc.exe^ ^&^ \\^"^"',
    )
  })

  it('preserves backslashes that are not adjacent to a quote', () => {
    expect(escapeArgForWindowsShell('C:\\Users\\me')).toEqual(
      '^"C:\\Users\\me^"',
    )
  })

  it('doubles trailing backslashes so they are not swallowed by the closing quote', () => {
    expect(escapeArgForWindowsShell('C:\\Users\\me\\')).toEqual(
      '^"C:\\Users\\me\\\\^"',
    )
  })
})
