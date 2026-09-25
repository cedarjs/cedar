export const UPLOADS_GITIGNORE_ENTRY = 'api/.uploads'

/**
 * Transforms `.gitignore` content by inserting `api/.uploads` after the
 * `dev.db*` line if present, or appending it at the end otherwise.
 *
 * Returns the same string if no change was needed.
 */
export function transformGitignore(source: string): string {
  const activeLines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (activeLines.includes(UPLOADS_GITIGNORE_ENTRY)) {
    return source
  }

  // Try to insert after the `dev.db*` line, keeping the db-related entries
  // together
  if (/^dev\.db\*$/m.test(source)) {
    return source.replace(/^(dev\.db\*)$/m, `$1\n${UPLOADS_GITIGNORE_ENTRY}`)
  }

  // Fall back to appending at the end, ensuring a trailing newline
  const withTrailingNewline = source.endsWith('\n') ? source : source + '\n'
  return withTrailingNewline + UPLOADS_GITIGNORE_ENTRY + '\n'
}
