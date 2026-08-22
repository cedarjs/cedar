import { describe, expect, it } from 'vitest'

import { quoteForWindowsShell } from '../background.js'

describe('quoteForWindowsShell', () => {
  it('quotes a path containing a space', () => {
    // Unquoted, the shell splits at the space, node tries to load
    // `C:\Users\Ada` and the background process dies with MODULE_NOT_FOUND --
    // silently, because its output is redirected to a log file
    expect(quoteForWindowsShell('C:\\Users\\Ada Lovelace\\app\\send.js')).toBe(
      '"C:\\Users\\Ada Lovelace\\app\\send.js"',
    )
  })

  it('quotes a bare command name', () => {
    expect(quoteForWindowsShell('yarn')).toBe('"yarn"')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteForWindowsShell('{"a":1}')).toBe('"{\\"a\\":1}"')
  })

  it('doubles a trailing backslash so it cannot escape the closing quote', () => {
    expect(quoteForWindowsShell('C:\\Program Files\\')).toBe(
      '"C:\\Program Files\\\\"',
    )
  })
})
