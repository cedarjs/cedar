/**
 * Turns an error (or any thrown value) into a message that is safe to send
 * with telemetry.
 *
 * Only the first line is kept, because some errors include the full stack
 * trace in the message. URLs (including connection strings like
 * `postgres://user:pass@host/db`) are replaced with `[url]`, and POSIX,
 * Windows and relative file paths are replaced with `[path]`. Hostnames in DNS
 * errors and IPv4 addresses are replaced with `[host]`. What is left is
 * the shape of the error, without user names, project names, hostnames or
 * credentials.
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
      // URLs and connection strings, e.g. `https://…` or `postgres://…`.
      // The lookbehind only lets a scheme start where a run of scheme
      // characters starts, which keeps matching linear on long runs of them
      .replace(
        /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"`]*/g,
        '[url]',
      )
      // Quoted paths, which can contain spaces, e.g. `'C:\Users\Ada L\x.db'`.
      // The part before the first separator can't contain a separator, so
      // there is only one way to match and matching stays linear
      .replace(/(['"`])[^'"`\\/\n]*[\\/][^'"`\n]*\1/g, '$1[path]$1')
      // UNC paths, e.g. `\\fileserver\share\…`
      .replace(/\\\\[^\s'"`]+/g, '[path]')
      // Windows paths, e.g. `C:\Users\…`
      .replace(/[A-Za-z]:\\[^\s'"`]*/g, '[path]')
      // Hosts in Node DNS errors, e.g. `getaddrinfo ENOTFOUND db.corp`
      .replace(/\b(ENOTFOUND|EAI_AGAIN)\s+[^\s'"`]+/g, '$1 [host]')
      // IPv4 addresses with an optional port, e.g. `10.0.3.7:5432`
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[host]')
      // POSIX and relative paths, e.g. `/Users/…`, `~/…`, `./…` and `../…`
      .replace(/(?:~|\.{1,2})?(?:\/[^\s/'"`]+)+\/?/g, '[path]')
  )
}

/**
 * Returns a new Error that only carries the redacted message of `error`.
 * The original stack trace is left out, since it contains file paths.
 */
export function redactError(error: unknown): Error {
  const redacted = new Error(redactErrorMessage(error))

  if (error instanceof Error) {
    redacted.name = error.name
  }

  // The stack would point at this function, which is noise, and the original
  // stack is exactly the information that must not be sent
  redacted.stack = `${redacted.name}: ${redacted.message}`

  return redacted
}
