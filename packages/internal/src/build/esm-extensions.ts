import fs from 'node:fs'
import path from 'node:path'

/**
 * For ESM projects using esbuild with `bundle: false`, rewrites extensionless
 * relative imports to include `.js` extension so that Node's ESM resolver can
 * locate the compiled output files at runtime.
 *
 * Handles both static imports (`from '../lib/db'`) and dynamic imports
 * (`import('../lib/db')`).
 *
 * Always outputs `.js` because esbuild with `loader: 'js'` compiles all source
 * files (`.ts`, `.tsx`, `.jsx`) to `.js` output. For a source file `api/src/lib/db.ts`
 * or `api/src/lib/db.tsx`, the output is always `api/dist/lib/db.js`, so all
 * import specifiers must use `.js` at runtime.
 *
 * This replaces the `resolvePath` hook in `babel-plugin-module-resolver` for
 * the standalone esbuild build path (`runCedarBabelTransformsPlugin`), which
 * was previously responsible for this extension-appending behaviour.  Vite
 * and Rollup resolve extensions themselves during bundling; only the esbuild
 * `bundle: false` path needs explicit extension suffixes in the source.
 *
 * It is a plain function called inline — not an esbuild plugin — following
 * the same pattern as `applySrcAlias`, `applyTsconfigPaths`, etc.
 *
 * Example: in `api/src/functions/graphql.ts` importing `../lib/db`, this
 * rewrites it to `../lib/db.js` when `api/src/lib/db.ts` (or `db.tsx`)
 * exists on disk.
 */
export function applyEsmExtensions(code: string, fromFile: string): string {
  const fromDir = path.dirname(fromFile)

  const rewriteImportPath = (
    importPath: string,
    preservePrefix: string,
    preserveSuffix: string,
  ): string => {
    const existingExt = path.extname(importPath)

    // Already has a concrete non-JS extension (.json, .css, .svg, …) — leave
    // it alone.
    if (existingExt && existingExt !== '.js' && existingExt !== '.jsx') {
      return preservePrefix + importPath + preserveSuffix
    }

    // Strip any existing .js/.jsx suffix so we can probe with all variants.
    const base = existingExt
      ? importPath.slice(0, -existingExt.length)
      : importPath
    const absBase = path.join(fromDir, base)

    // Probe for .ts / .js / .tsx / .jsx (always output .js).
    // esbuild compiles all extensions to .js files when loader is 'js'.
    if (
      fs.existsSync(absBase + '.ts') ||
      fs.existsSync(absBase + '.js') ||
      fs.existsSync(absBase + '.tsx') ||
      fs.existsSync(absBase + '.jsx')
    ) {
      return preservePrefix + base + '.js' + preserveSuffix
    }

    return preservePrefix + importPath + preserveSuffix
  }

  // Handle static imports/exports: `from '../lib/db'` or `from "../lib/db"`
  let result = code.replace(
    /\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (match, quote, importPath) => {
      return `from ${rewriteImportPath(importPath, quote, quote)}`
    },
  )

  // Handle dynamic imports: `import('../lib/db')` or `import("../lib/db")`
  result = result.replace(
    /\bimport\s*\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g,
    (match, quote, importPath) => {
      return `import(${rewriteImportPath(importPath, quote, quote)})`
    },
  )

  return result
}
