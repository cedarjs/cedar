import fs from 'node:fs'
import path from 'node:path'

/**
 * For ESM projects using esbuild with `bundle: false`, rewrites extensionless
 * relative imports to include the correct `.js` or `.jsx` extension so that
 * Node's ESM resolver can locate the compiled output files at runtime.
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
 * rewrites it to `../lib/db.js` when `api/src/lib/db.ts` (or `db.js`)
 * exists on disk.
 */
export function applyEsmExtensions(code: string, fromFile: string): string {
  const fromDir = path.dirname(fromFile)

  return code.replace(
    /\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (match, quote, importPath) => {
      const existingExt = path.extname(importPath)

      // Already has a concrete non-JS extension (.json, .css, .svg, …) — leave
      // it alone.
      if (existingExt && existingExt !== '.js' && existingExt !== '.jsx') {
        return match
      }

      // Strip any existing .js/.jsx suffix so we can probe with all variants.
      const base =
        existingExt ? importPath.slice(0, -existingExt.length) : importPath
      const absBase = path.join(fromDir, base)

      // Probe for .ts / .js first (prefer .js extension in output).
      if (fs.existsSync(absBase + '.ts') || fs.existsSync(absBase + '.js')) {
        return `from ${quote}${base}.js${quote}`
      }

      // Probe for .tsx / .jsx (use .jsx extension in output).
      if (fs.existsSync(absBase + '.tsx') || fs.existsSync(absBase + '.jsx')) {
        return `from ${quote}${base}.jsx${quote}`
      }

      return match
    },
  )
}
