import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

const EXTENSIONS = ['.js', '.tsx', '.ts', '.jsx', '.mjs', '.mts', '.cjs']

function resolveFile(filePath: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = `${filePath}${ext}`
    if (fs.existsSync(p)) {
      return p
    }
  }
  return null
}

/**
 * Vite plugin that resolves "directory named" imports — where a directory
 * contains a file with the same name as the directory itself, or an index file.
 *
 * Given an import `import { Foo } from './Foo'` where `./Foo` is a directory,
 * this plugin tries:
 * 1. `./Foo/index` — preferred (index file)
 * 2. `./Foo/Foo` — directory-named module
 *
 * This replaces `babel-plugin-redwood-directory-named-import` for Vite builds.
 */
export function cedarDirectoryNamedImportPlugin(): Plugin {
  return {
    name: 'cedar-directory-named-import',
    resolveId(id, importer) {
      // Only process relative imports
      if (!id.startsWith('.') || !importer) {
        return null
      }

      // We only operate in "userland", skip node_modules
      if (importer.includes('/node_modules/')) {
        return null
      }

      const importerDir = path.dirname(importer)
      const absoluteBase = path.resolve(importerDir, id)

      // If the import resolves directly with a known extension, skip
      if (resolveFile(absoluteBase)) {
        return null
      }

      const dirname = path.dirname(id)
      const basename = path.basename(id)

      // Try index.[js*|ts*] first — preferred default behaviour
      const indexPath = path.resolve(importerDir, dirname, basename, 'index')
      const resolvedIndex = resolveFile(indexPath)
      if (resolvedIndex) {
        return normalizePath(resolvedIndex)
      }

      // Try directory-named module (same name as directory)
      const dirnamePath = path.resolve(importerDir, dirname, basename, basename)
      const resolvedDirname = resolveFile(dirnamePath)
      if (resolvedDirname) {
        return normalizePath(resolvedDirname)
      }

      return null
    },
  }
}
