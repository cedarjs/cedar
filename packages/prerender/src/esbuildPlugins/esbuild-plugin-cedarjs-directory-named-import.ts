import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'esbuild'

import { resolveFile } from '@cedarjs/project-config'

import { getNewPath } from './helpers'

/**
 * esbuild plugin that transforms imports like
 * `import MyPage from './src/pages/MyPage'` to
 * `import MyPage from './src/pages/MyPage/MyPage'`
 */
export default function cedarjsDirectoryNamedImportPlugin(): Plugin {
  return {
    name: 'cedarjs-directory-named-import',
    setup(build) {
      // Filter to only handle relative imports and avoid node_modules
      build.onResolve({ filter: /^\./ }, (args) => {
        console.log('build.onResolve relative path', args.path)
        console.log('build.onResolve relative importer', args.importer)
        const { path: importPath, importer } = args

        // Skip if no importer (shouldn't happen for relative imports)
        if (!importer) {
          return
        }

        // We only operate in "userland," skip node_modules
        if (importer.includes('/node_modules/')) {
          return
        }

        // First, try to resolve the original path normally
        // If it resolves, we don't need to transform it
        try {
          const originalResolved = path.resolve(
            path.dirname(importer),
            importPath,
          )

          if (
            fs.existsSync(originalResolved) ||
            resolveFile(originalResolved)
          ) {
            return // Let esbuild handle the normal resolution
          }
        } catch {
          // Continue with transformation attempt
        }

        // Try to find the transformed path
        const newPath = getNewPath(importPath, importer)
        if (!newPath) {
          return // Let esbuild handle (and potentially fail) the original resolution
        }

        // Return the transformed path for esbuild to resolve
        return {
          path: newPath,
          external: false,
        }
      })

      // Also handle absolute imports that might need transformation
      build.onResolve({ filter: /^[/\\]/ }, (args) => {
        console.log('build.onResolve absolute path', args.path)
        console.log('build.onResolve absolute importer', args.importer)

        const { path: importPath, importer } = args

        // // Skip relative imports (handled above)
        // if (importPath.startsWith('.')) {
        //   return
        // }

        // // Skip built-in modules and node_modules
        // if (!importPath.startsWith('/') && !importPath.startsWith('\\')) {
        //   return
        // }

        // Skip if no importer
        if (!importer) {
          return
        }

        // We only operate in "userland," skip node_modules
        if (importer.includes('/node_modules/')) {
          return
        }

        // First, try to resolve the original path normally
        try {
          if (resolveFile(importPath)) {
            return // Let esbuild handle the normal resolution
          }
        } catch {
          // Continue with transformation attempt
        }

        // For absolute paths, we need to handle them differently
        const dirname = path.dirname(importPath)
        const basename = path.basename(importPath)

        // Try index file first
        const indexPath = path.join(dirname, basename, 'index')
        if (resolveFile(indexPath)) {
          return {
            path: indexPath,
            external: false,
          }
        }

        // Try directory-named file
        const dirnamePath = path.join(dirname, basename, basename)
        if (resolveFile(dirnamePath)) {
          return {
            path: dirnamePath,
            external: false,
          }
        }

        return // Let esbuild handle (and potentially fail) the original resolution
      })
    },
  }
}
