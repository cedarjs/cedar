import { describe, expect, it } from 'vitest'

import { quoteForWindowsShell } from '../telemetry.js'

describe('quoteForWindowsShell', () => {
  it('quotes a path containing a space', () => {
    // The bug this exists for: unquoted, the shell splits at the space and
    // node tries to load `D:\a\cedar\test`
    expect(quoteForWindowsShell('D:\\a\\cedar\\test project\\invoke.js')).toBe(
      '"D:\\a\\cedar\\test project\\invoke.js"',
    )
  })

  it('quotes a path without a space', () => {
    expect(quoteForWindowsShell('D:\\a\\cedar\\cedar\\invoke.js')).toBe(
      '"D:\\a\\cedar\\cedar\\invoke.js"',
    )
  })

  it('escapes the double quotes in a JSON payload', () => {
    // `--argv` is passed as JSON.stringify(...), so it always contains quotes
    expect(quoteForWindowsShell('["node","cedar","build"]')).toBe(
      '"[\\"node\\",\\"cedar\\",\\"build\\"]"',
    )
  })

  it('handles a JSON payload that also contains a space', () => {
    expect(quoteForWindowsShell('["cedar","g","page","My Page"]')).toBe(
      '"[\\"cedar\\",\\"g\\",\\"page\\",\\"My Page\\"]"',
    )
  })

  it('doubles a trailing backslash so it cannot escape the closing quote', () => {
    expect(quoteForWindowsShell('C:\\Users\\Ada Lovelace\\')).toBe(
      '"C:\\Users\\Ada Lovelace\\\\"',
    )
  })

  it('doubles backslashes that precede a double quote', () => {
    expect(quoteForWindowsShell('a\\"b')).toBe('"a\\\\\\"b"')
  })

  it('leaves an argument with nothing to escape intact inside the quotes', () => {
    expect(quoteForWindowsShell('--argv')).toBe('"--argv"')
  })
})
