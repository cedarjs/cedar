import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { resolveFile } from '@cedarjs/project-config'

/**
 * Resolves bare directory imports to the index file or directory-named module.
 *
 * When you import `./Button`, this plugin checks:
 * 1. `./Button/index.[js|ts|tsx|jsx|...]` — preferred if it exists
 * 2. `./Button/Button.[js|ts|tsx|jsx|...]` — directory-named module fallback
 *
 * This mirrors the behaviour of babel-plugin-redwood-directory-named-import.
 */
export function cedarDirectoryNamedImportPlugin(): Plugin {
  return {
    name: 'vite-plugin-cedar-directory-named-import',

    resolveId(id, importer) {
      // Only handle relative imports
      if (!id.startsWith('.') || !importer) {
        return null
      }

      // We only operate in "userland," skip node_modules.
      if (normalizePath(importer).includes('/node_modules/')) {
        return null
      }

      const absolutePath = path.resolve(path.dirname(importer), id)

      // If the import already points to a real file, leave it alone.
      if (resolveFile(absolutePath)) {
        return null
      }

      const basename = path.basename(absolutePath)

      // We try to resolve `index.[js*|ts*]` modules first,
      // since that's the desired default behaviour
      const indexPath = absolutePath + '/index'
      const resolvedIndex = resolveFile(indexPath)
      if (resolvedIndex) {
        return resolvedIndex
      }

      // No index file found, so try to import the directory-named-module instead
      const dirnamedPath = absolutePath + '/' + basename
      const resolvedDirnamed = resolveFile(dirnamedPath)
      if (resolvedDirnamed) {
        return resolvedDirnamed
      }

      return null
    },
  }
}
