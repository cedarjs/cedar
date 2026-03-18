import fs from 'node:fs'

export type UpdatePrismaConfigResult = 'skipped' | 'unmodified' | 'updated'

/**
 * Adds `env` to the `require('prisma/config')` destructure and inserts a
 * `datasource: { url: env('DATABASE_URL') }` block into `defineConfig(...)`.
 */
export function transformPrismaConfig(source: string): string {
  // Idempotency: already has datasource block
  if (/datasource\s*:/.test(source)) {
    return source
  }

  let result = source

  // Step 1: add `env` to the require destructure if not already there
  if (!/\benv\b/.test(result)) {
    result = result.replace(
      /const\s*\{([^}]*)\}\s*=\s*require\(['"]prisma\/config['"]\)/,
      (match, destructured: string) => {
        const trimmed = destructured.trim()
        return `const { ${trimmed}, env } = require('prisma/config')`
      },
    )
  }

  // Step 2: insert the datasource block before the final `})` of defineConfig
  // Find the last `},` or `}` that closes the last property, then insert after it.
  // Strategy: find the closing `})` of the top-level defineConfig call and
  // insert our block before it.
  //
  // We look for the last occurrence of a `}` followed (possibly with whitespace
  // and an optional comma) by a newline and then the closing `})`.
  result = result.replace(
    /(\n[ \t]*\}[ \t]*,?\s*\n)([ \t]*\}\))/,
    (match, lastPropClose, closingParen) => {
      const indent = lastPropClose.match(/^(\n([ \t]*))/)?.[2] ?? '  '
      const propIndent = indent
      const innerIndent = indent + '  '
      return (
        lastPropClose +
        `${propIndent}datasource: {\n` +
        `${innerIndent}url: env('DATABASE_URL'),\n` +
        `${propIndent}},\n` +
        closingParen
      )
    },
  )

  return result
}

export async function updatePrismaConfig(
  configPath: string,
): Promise<UpdatePrismaConfigResult> {
  if (!fs.existsSync(configPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(configPath, 'utf-8')

  // Idempotency
  if (/datasource\s*:/.test(source)) {
    return 'unmodified'
  }

  const transformed = transformPrismaConfig(source)

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(configPath, transformed, 'utf-8')
  return 'updated'
}
