import path from 'node:path'

import { createMatchPath, loadConfig } from 'tsconfig-paths'

import { importStatementPath } from '@cedarjs/project-config'

/**
 * Rewrites bare-specifier imports that match a user-defined tsconfig.json
 * `compilerOptions.paths` alias to relative paths, so that the esbuild API
 * build (with `bundle: false`) produces output files with resolvable import
 * paths at runtime.
 *
 * This replaces the `babel-plugin-module-resolver`'s tsconfig-paths handling
 * for the esbuild build paths. It is a plain function called inline from the
 * existing esbuild `onLoad` handlers — not an esbuild plugin itself, since
 * esbuild's `onResolve` hook (which most tsconfig-paths plugins use) is never
 * invoked when `bundle: false`.
 *
 * Excludes the same keys `getPathsFromTypeScriptConfig` (in
 * @cedarjs/babel-config) excludes: `src/*` is handled by applySrcAlias,
 * `$api/*` is web-only, `types/*` is type-only, and `@cedarjs/*` are real
 * package imports.
 */

const EXCLUDED_PATH_KEY_RE = /src\/|\$api\/\*|types\/\*|@cedarjs\/.*/

const RESOLVE_EXTENSIONS = [
  '.js',
  '.tsx',
  '.ts',
  '.jsx',
  '.mjs',
  '.mts',
  '.cjs',
]

// Matches `from '<specifier>'`, where <specifier> doesn't start with `.` or
// `/` (i.e. it's a bare specifier, not a relative or absolute path).
const BARE_IMPORT_RE = /\bfrom\s+(['"])([^'"./][^'"]*)\1/g

function getMatchPath(cwd: string) {
  const config = loadConfig(cwd)

  if (config.resultType === 'failed') {
    return null
  }

  const paths = Object.fromEntries(
    Object.entries(config.paths).filter(
      ([key]) => !EXCLUDED_PATH_KEY_RE.test(key),
    ),
  )

  if (Object.keys(paths).length === 0) {
    return null
  }

  return createMatchPath(config.absoluteBaseUrl, paths)
}

export function applyTsconfigPaths(
  code: string,
  filePath: string,
  cwd: string,
): string {
  const matchPath = getMatchPath(cwd)

  if (!matchPath) {
    return code
  }

  return code.replace(
    BARE_IMPORT_RE,
    (full: string, quote: string, importPath: string) => {
      const resolved = matchPath(
        importPath,
        undefined,
        undefined,
        RESOLVE_EXTENSIONS,
      )

      if (!resolved) {
        return full
      }

      const relativePath = path.relative(path.dirname(filePath), resolved)
      const formatted = importStatementPath(
        relativePath.startsWith('.') ? relativePath : './' + relativePath,
      )

      return `from ${quote}${formatted}${quote}`
    },
  )
}
