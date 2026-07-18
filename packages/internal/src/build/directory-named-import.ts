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
 *
 * Matches static `import`/`export` statements, including side-effect-only
 * imports (`import './Button'`) — the babel plugin this replaces visits every
 * `ImportDeclaration`/`ExportDeclaration`, which covers those too. Anchored to
 * the start of a line (like `applyImportDir`'s glob-import regex) so that
 * text resembling an import inside a string, template literal, or comment
 * isn't rewritten, and excludes dynamic `import(...)` calls (the babel plugin
 * doesn't rewrite those either).
 */

const RELATIVE_IMPORT_RE =
  /^(\s*(?:import|export)\s[^'"\n]*?)(['"])(\.\.?\/[^'"]+)\2/gm

export function applyDirectoryNamedImport(
  code: string,
  filePath: string,
): string {
  const fileDir = path.dirname(filePath)

  return code.replace(
    RELATIVE_IMPORT_RE,
    (match: string, prefix: string, quote: string, importPath: string) => {
      const absolutePath = path.join(fileDir, importPath)

      // Already resolves directly to a file — leave it alone.
      if (resolveFile(absolutePath)) {
        return match
      }

      if (resolveFile(path.join(absolutePath, 'index'))) {
        return `${prefix}${quote}${importStatementPath(importPath + '/index')}${quote}`
      }

      const basename = path.basename(absolutePath)
      if (resolveFile(path.join(absolutePath, basename))) {
        return `${prefix}${quote}${importStatementPath(importPath + '/' + basename)}${quote}`
      }

      return match
    },
  )
}
