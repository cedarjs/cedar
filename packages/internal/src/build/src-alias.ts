import path from 'node:path'

import { importStatementPath } from '@cedarjs/project-config'

/**
 * Rewrites `src/` bare specifiers in source code to relative paths, so that the
 * esbuild API build (with `bundle: false`) produces output files with
 * resolvable import paths at runtime.
 *
 * This replaces the `babel-plugin-module-resolver` `src: './src'` alias for the
 * esbuild build paths. It is a plain function called inline from the existing
 * esbuild `onLoad` handlers — not an esbuild plugin itself.
 *
 * Handles the same import forms as `applyImportExtensions`: static
 * imports/re-exports (`from 'src/lib/db'`), side-effect imports
 * (`import 'src/lib/setup'`), dynamic imports (`import('src/lib/db')`) and
 * `require('src/lib/db')` calls. Template-literal specifiers are not
 * rewritten.
 *
 * For a file at `api/src/functions/graphql.ts` importing `src/lib/db`, this
 * rewrites it to `../lib/db`.
 */
export function applySrcAlias(
  code: string,
  fromDirRelativeToApiSrc: string,
): string {
  const toRelative = (rest: string) => {
    const target = path.relative(fromDirRelativeToApiSrc, rest)

    return importStatementPath(target.startsWith('.') ? target : './' + target)
  }

  // Static imports/re-exports: `from 'src/lib/db'`
  let result = code.replace(
    /from\s+['"]src\/(.+?)['"]/g,
    (_match: string, rest: string) => `from '${toRelative(rest)}'`,
  )

  // Side-effect imports: `import 'src/lib/setup'`. Anchored to statement
  // position (start of line or after a `;`), so import-statement text inside
  // string data is left alone.
  result = result.replace(
    /(^[ \t]*|;\s*)import\s+(['"])src\/([^'"]+)\2/gm,
    (_match: string, prefix: string, quote: string, rest: string) =>
      `${prefix}import ${quote}${toRelative(rest)}${quote}`,
  )

  // Dynamic imports: `import('src/lib/db')`
  result = result.replace(
    /\bimport\s*\(\s*(['"])src\/([^'"]+)\1\s*\)/g,
    (_match: string, quote: string, rest: string) =>
      `import(${quote}${toRelative(rest)}${quote})`,
  )

  // `require('src/lib/db')`: a custom api/babel.config.js can lower ESM
  // imports to CommonJS before this function runs.
  result = result.replace(
    /\brequire\s*\(\s*(['"])src\/([^'"]+)\1\s*\)/g,
    (_match: string, quote: string, rest: string) =>
      `require(${quote}${toRelative(rest)}${quote})`,
  )

  return result
}
