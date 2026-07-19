import path from 'node:path'

import { createMatchPath, loadConfig } from 'tsconfig-paths'

import { importStatementPath, resolveFile } from '@cedarjs/project-config'

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
 *
 * Also resolves an alias that points at a directory needing
 * directory-named-import resolution (e.g. `$services/todos` where `todos`
 * is a directory containing `todos.ts`) — applyDirectoryNamedImport only
 * handles relative specifiers, so a bare aliased specifier like this would
 * otherwise be left for babel-plugin-module-resolver, which doesn't
 * understand that convention.
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

// A successful matchPath "file"/"extension" match is already an
// extensionless path pointing straight at a resolvable file — keep it as-is.
// But its "index" match type instead returns the bare *directory* (stripping
// `/index.ext`), mirroring Node's classic `require()` directory fallback,
// which only exists for CJS — Node's ESM resolver has no such fallback. So a
// bare-directory result has to be turned into an explicit file here to work
// for both CJS and ESM. resolveFile is only used to check existence — like
// applyDirectoryNamedImport, the returned path is deliberately extensionless.
function resolveToFile(candidate: string): string | null {
  if (resolveFile(candidate)) {
    return candidate
  }

  if (resolveFile(path.join(candidate, 'index'))) {
    return path.join(candidate, 'index')
  }

  // Or a directory needing directory-named-import resolution (a CedarJS
  // convention matchPath itself doesn't know about).
  const basename = path.basename(candidate)
  if (resolveFile(path.join(candidate, basename))) {
    return path.join(candidate, basename)
  }

  return null
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
      // The alias may resolve straight to a file, to a directory with an
      // index file, or to a directory needing directory-named-import
      // resolution (e.g. a `$services/*` alias resolving to `services/todos`,
      // a directory containing `todos/todos.ts`, which matchPath itself
      // doesn't know about). Re-query with the dirname-named candidate when
      // the direct one fails.
      const basename = importPath.split('/').pop()
      const rawMatch =
        matchPath(importPath, undefined, undefined, RESOLVE_EXTENSIONS) ??
        (basename &&
          matchPath(
            `${importPath}/${basename}`,
            undefined,
            undefined,
            RESOLVE_EXTENSIONS,
          ))

      const resolved = rawMatch && resolveToFile(rawMatch)

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
