import execa from 'execa'

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
    // Keep leading whitespace: git treats it as part of the pattern, so an
    // indented `api/.uploads` line does not ignore the upload directory
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (activeLines.includes(UPLOADS_GITIGNORE_ENTRY)) {
    return source
  }

  // Try to insert after the `dev.db*` line, keeping the db-related entries
  // together
  if (/^dev\.db\*$/m.test(source)) {
    return source.replace(/^(dev\.db\*)$/m, `$1\n${UPLOADS_GITIGNORE_ENTRY}`)
  }

  // Fall back to appending at the end, on a line of its own
  const prefix = source === '' || source.endsWith('\n') ? source : source + '\n'
  return prefix + UPLOADS_GITIGNORE_ENTRY + '\n'
}

/**
 * Returns the subset of `paths` that a pre-existing `.gitignore` rule hides
 * from git — most commonly a leftover, unanchored `uploads` or `uploads/`
 * line from a `@cedarjs/storage` migration, which also matches the new
 * `api/src/services/uploads/` directory this setup command generates.
 *
 * Resolves to an empty array if `git check-ignore` can't run (not a git
 * repository, git isn't installed, and so on) — there's nothing meaningful
 * to warn about in that case.
 */
export async function findIgnoredPaths(
  cwd: string,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) {
    return []
  }

  try {
    // Exit code 1 just means none of the paths are ignored; only a thrown
    // error (not a git repo, git missing, and so on) is unexpected here.
    const { stdout } = await execa('git', ['check-ignore', ...paths], {
      cwd,
      reject: false,
    })

    return stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}
