/**
 * Turns an error (or any thrown value) into a message that is safe to send
 * with telemetry.
 *
 * Only the first line is kept, because some errors include the full stack
 * trace in the message. URLs (including connection strings like
 * `postgres://user:pass@host/db`) are replaced with `[url]`, and POSIX,
 * Windows and relative file paths are replaced with `[path]`. What is left is
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
      // URLs and connection strings, e.g. `https://…` or `postgres://…`
      .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"`]*/g, '[url]')
      // Windows paths, e.g. `C:\Users\…`
      .replace(/[A-Za-z]:\\[^\s'"`]*/g, '[path]')
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
