import fs from 'node:fs'
import path from 'node:path'

import type { PluginBuild } from 'esbuild'

/**
 * esbuild plugin that rewrites `src/` bare specifiers to relative paths, so
 * that the esbuild API build (with `bundle: false`) produces output files with
 * resolvable import paths at runtime.
 *
 * This replaces the `babel-plugin-module-resolver` `src: './src'` alias for
 * the esbuild build paths (`cedar-esbuild-babel-transform`,
 * `cedar-api-graphql`, `cedar-vite-api-babel-transform`). Module-resolution
 * runs in esbuild itself rather than in Babel, so the Babel plugin can
 * eventually be dropped without losing `src/` imports.
 *
 * For a file at `api/src/functions/graphql.ts` importing `src/lib/db`, the
 * plugin rewrites it to `../lib/db` (and resolves the extension if needed).
 */

export const cedarEsbuildSrcAliasPlugin = {
  name: 'cedar-esbuild-src-alias',
  setup(build: PluginBuild) {
    build.onLoad({ filter: /\.(js|ts|tsx|jsx)$/ }, async (args) => {
      // The absWorkingDir for API builds is api/ (set in getEsbuildOptions),
      // so apiSrc is `src/` relative to that root.
      const apiSrcDir = path.resolve(
        build.initialOptions.absWorkingDir ?? '.',
        'src',
      )

      // Only rewrite files under api/src/
      const relToApiSrc = path.relative(apiSrcDir, args.path)
      if (relToApiSrc.startsWith('..')) {
        // File is outside api/src/ — skip
        return undefined
      }

      const contents = await fs.promises.readFile(args.path, 'utf-8')
      const srcDirForResolve = path.dirname(path.relative(apiSrcDir, args.path))

      // Rewrite `from 'src/<rest>'` to a relative path
      const rewritten = contents.replace(
        /from\s+['"]src\/(.+?)['"]/g,
        (_match: string, rest: string) => {
          const target = path.relative(srcDirForResolve, rest)
          const formatted = target.startsWith('.') ? target : './' + target
          return `from '${formatted}'`
        },
      )

      if (rewritten !== contents) {
        return {
          contents: rewritten,
          loader: 'js',
        }
      }

      return undefined
    })
  },
}
