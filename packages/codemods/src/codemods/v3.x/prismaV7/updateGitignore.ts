import fs from 'node:fs'

export type UpdateGitignoreResult = 'skipped' | 'unmodified' | 'updated'

const GENERATED_PRISMA_ENTRY = 'api/db/generated/prisma'

/**
 * Transforms `.gitignore` content by inserting `api/db/generated/prisma`
 * after the `dev.db*` line if present, or appending it at the end otherwise.
 *
 * Returns the same string if no change was needed.
 */
export function transformGitignore(source: string): string {
  if (source.includes(GENERATED_PRISMA_ENTRY)) {
    return source
  }

  // Try to insert after the `dev.db*` line
  if (/^dev\.db\*/m.test(source)) {
    return source.replace(/^(dev\.db\*)$/m, `$1\n${GENERATED_PRISMA_ENTRY}`)
  }

  // Fall back to appending at the end, ensuring a trailing newline
  const withTrailingNewline = source.endsWith('\n') ? source : source + '\n'
  return withTrailingNewline + GENERATED_PRISMA_ENTRY + '\n'
}

export async function updateGitignore(
  gitignorePath: string,
): Promise<UpdateGitignoreResult> {
  if (!fs.existsSync(gitignorePath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(gitignorePath, 'utf-8')

  if (source.includes(GENERATED_PRISMA_ENTRY)) {
    return 'unmodified'
  }

  const transformed = transformGitignore(source)

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(gitignorePath, transformed, 'utf-8')
  return 'updated'
}
