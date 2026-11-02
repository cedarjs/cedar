/**
 * Turns an error (or any thrown value) into a message that is safe to send
 * with telemetry.
 *
 * Only the first line is kept, because some errors include the full stack
 * trace in the message. URLs (including connection strings like
 * `postgres://user:pass@host/db`) are replaced with `[url]`, and POSIX,
 * Windows and relative file paths are replaced with `[path]`. Hostnames in DNS
 * errors and IPv4 addresses are replaced with `[host]`.
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
      // URLs and connection strings, e.g. `https://…` or `postgres://…`.
      // The lookbehind only lets a scheme start where a run of scheme
      // characters starts, which keeps matching linear on long runs of them
      .replace(
        /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"`]*/g,
        '[url]',
      )
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
