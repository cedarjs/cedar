import path from 'node:path'

import type { Plugin } from 'rollup'

import { resolveFile } from '@cedarjs/project-config'

const getNewPath = (value: string, filename: string): string | null => {
  const dirname = path.dirname(value)
  const basename = path.basename(value)

  // We try to resolve `index.[js*|ts*]` modules first,
  // since that's the desired default behavior
  const indexImportPath = [dirname, basename, 'index'].join('/')
  if (resolveFile(path.resolve(path.dirname(filename), indexImportPath))) {
    return indexImportPath
  } else {
    // No index file found, so try to import the directory-named-module instead
    const dirnameImportPath = [dirname, basename, basename].join('/')

    if (resolveFile(path.resolve(path.dirname(filename), dirnameImportPath))) {
      return dirnameImportPath
    }
  }

  return null
}

export function cedarjsDirectoryNamedImportPlugin(): Plugin {
  return {
    name: 'cedarjs-directory-named-import',

    resolveId(id: string, importer?: string) {
      // Skip if no importer (entry point) or if in node_modules
      if (!importer || importer.includes('/node_modules/')) {
        return null
      }

      // Skip relative imports that start with . or absolute paths
      if (id.startsWith('.') || path.isAbsolute(id)) {
        return null
      }

      // We only need this plugin when the module could not be found
      try {
        require.resolve(id, { paths: [path.dirname(importer)] })
        return null // Module can be resolved normally
      } catch {
        // Continue with custom resolution
      }

      const newPath = getNewPath(id, importer)
      if (!newPath) {
        return null
      }

      // Convert to absolute path for Rollup
      const resolvedPath = path.resolve(path.dirname(importer), newPath)
      return resolvedPath
    },
  }
}
