/**
 * Turns an error (or any thrown value) into a message that is safe to send
 * with telemetry.
 *
 * Only the first line is kept, because some errors include the full stack
 * trace in the message. URLs (including connection strings like
 * `postgres://user:pass@host/db`) are replaced with `[url]`, and POSIX,
 * Windows and relative file paths are replaced with `[path]`.
 *
 * The same function is exported from `@cedarjs/cli-helpers/telemetry`.
 * `@cedarjs/cli-helpers` depends on this package, so this package keeps its
 * own copy instead of importing it from there.
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
