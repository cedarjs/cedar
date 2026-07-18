import path from 'node:path'

import { importStatementPath, resolveFile } from '@cedarjs/project-config'

/**
 * Rewrites relative imports/re-exports of a directory to that directory's
 * index file or directory-named module, so that the esbuild API build (with
 * `bundle: false`) produces output files with resolvable import paths at
 * runtime.
 *
 * This replaces `babel-plugin-redwood-directory-named-import` for the esbuild
 * build paths. It is a plain function called inline from the existing esbuild
 * `onLoad` handlers — not an esbuild plugin itself.
 *
 * For a file importing `./Button` where `./Button/Button.tsx` exists (but
 * `./Button.*` does not), this rewrites the import to `./Button/Button`.
 * Mirrors the precedence used by `cedarDirectoryNamedImportPlugin` (Vite):
 * an index file wins over a directory-named module.
 */

const RELATIVE_IMPORT_RE = /\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g

export function applyDirectoryNamedImport(
  code: string,
  filePath: string,
): string {
  const fileDir = path.dirname(filePath)

  return code.replace(
    RELATIVE_IMPORT_RE,
    (match: string, quote: string, importPath: string) => {
      const absolutePath = path.join(fileDir, importPath)

      // Already resolves directly to a file — leave it alone.
      if (resolveFile(absolutePath)) {
        return match
      }

      if (resolveFile(path.join(absolutePath, 'index'))) {
        return `from ${quote}${importStatementPath(importPath + '/index')}${quote}`
      }

      const basename = path.basename(absolutePath)
      if (resolveFile(path.join(absolutePath, basename))) {
        return `from ${quote}${importStatementPath(importPath + '/' + basename)}${quote}`
      }

      return match
    },
  )
}
