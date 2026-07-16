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
 * For a file at `api/src/functions/graphql.ts` importing `src/lib/db`, this
 * rewrites it to `../lib/db`.
 */

export function applySrcAlias(
  code: string,
  fromDirRelativeToApiSrc: string,
): string {
  return code.replace(
    /from\s+['"]src\/(.+?)['"]/g,
    (_match: string, rest: string) => {
      const target = path.relative(fromDirRelativeToApiSrc, rest)
      const formatted = importStatementPath(
        target.startsWith('.') ? target : './' + target,
      )
      return `from '${formatted}'`
    },
  )
}
