/**
 * Turns an error (or any thrown value) into a message that is safe to send
 * with telemetry.
 *
 * Only the first line is kept, because some errors include the full stack
 * trace in the message. Then every word that could identify a user, their
 * project or their infrastructure is replaced: anything containing `/`, `\`,
 * `@` or `:`, and IPv4 addresses. Replacements are labelled `[url]`, `[host]`,
 * `[path]` or `[redacted]`. Quoted paths are replaced as a whole, since they
 * can contain spaces, and so are hostnames in DNS errors.
 *
 * Words that describe the failure without identifying anyone are kept:
 * scoped package names (`@cedarjs/vite`), known specifiers (`node:fs`),
 * version numbers, clock times and words that only end in a colon (`Error:`).
 * What is left is the shape of the error, e.g.
 * `ENOENT: no such file or directory, open '[path]'`.
 *
 * This module has no imports so it can be bundled into create-cedar-app
 * without pulling in anything else.
 */
export function redactErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error)

  return (
    (message.split('\n')[0] || 'Unknown error')
      // Quoted strings that contain a path separator, e.g.
      // `'C:\Users\Ada Lovelace\x.db'`. The part before the first separator
      // can't contain a separator, so there is only one way to match and
      // matching stays linear
      .replace(
        /(['"`])([^'"`\\/\n]*[\\/][^'"`\n]*)\1/g,
        (_match, quote: string, inner: string) =>
          `${quote}${isSafeWord(inner) ? inner : placeholderFor(inner)}${quote}`,
      )
      // Hosts in Node DNS errors, e.g. `getaddrinfo ENOTFOUND db.corp`. Bare
      // hostnames have no character that marks them as identifying
      .replace(/\b(ENOTFOUND|EAI_AGAIN)\s+[^\s'"`]+/g, '$1 [host]')
      .replace(/\S+/g, redactWord)
  )
}

const SCOPED_PACKAGE =
  /^@[a-z0-9~-][\w.~-]*\/[a-z0-9~-][\w.~-]*(?:\/[\w.-]+)*(?:@[\w.^~*<>=-]+)?$/i
const KNOWN_SPECIFIER = /^(?:node|npm|workspace|catalog):[\w.^~*<>=-]*$/
const CLOCK_TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/
// Four groups of 1-3 digits that aren't part of a longer dotted number
const IPV4 = /(?:^|[^\d.])\d{1,3}(?:\.\d{1,3}){3}(?![.\d])/
const IPV6 = /^\[?[\da-f]*:[\da-f]*:[\da-f:]*\]?(?::\d+)?$/i
const HOST_AND_PORT = /^[\w.-]+:\d+$/

const LEADING_PUNCTUATION = new Set(['(', "'", '"', '`', '<', '[', '{'])
const TRAILING_PUNCTUATION = new Set([
  ')',
  "'",
  '"',
  '`',
  '>',
  ']',
  '}',
  ',',
  ';',
  '.',
  '!',
  '?',
])

function isSafeWord(word: string) {
  if (!/[/\\@:]/.test(word) && !IPV4.test(word)) {
    return true
  }

  return (
    SCOPED_PACKAGE.test(word) ||
    KNOWN_SPECIFIER.test(word) ||
    (word.startsWith('npm:') && SCOPED_PACKAGE.test(word.slice(4))) ||
    CLOCK_TIME.test(word)
  )
}

function placeholderFor(word: string) {
  if (word.includes('://')) {
    return '[url]'
  }

  if (IPV4.test(word) || IPV6.test(word) || HOST_AND_PORT.test(word)) {
    return '[host]'
  }

  if (/[/\\]/.test(word)) {
    return '[path]'
  }

  return '[redacted]'
}

/**
 * Redacts one whitespace-separated word. Punctuation around the word, like
 * quotes, brackets and a sentence's final period, is kept and not checked.
 */
function redactWord(word: string) {
  let start = 0
  let end = word.length

  while (end > start && TRAILING_PUNCTUATION.has(word[end - 1])) {
    end--
  }

  // A bracketed IPv6 address, e.g. `[::1]:5432`, starts with what would
  // otherwise be treated as punctuation
  const withoutTrailing = word.slice(0, end)

  if (!CLOCK_TIME.test(withoutTrailing) && IPV6.test(withoutTrailing)) {
    return '[host]' + word.slice(end)
  }

  while (start < end && LEADING_PUNCTUATION.has(word[start])) {
    start++
  }

  const core = word.slice(start, end)
  // A single trailing colon, like in `Error:` or `C:`, doesn't identify anyone
  const checked = core.endsWith(':') ? core.slice(0, -1) : core

  if (checked === '' || isSafeWord(checked)) {
    return word
  }

  return word.slice(0, start) + placeholderFor(core) + word.slice(end)
}
