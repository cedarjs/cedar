import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

import { resolveFile } from '@cedarjs/project-config'

function getNewPath(value: string, filename: string) {
  const dirname = path.dirname(value)
  const basename = path.basename(value)

  // We try to resolve `index.[js*|ts*]` modules first,
  // since that's the desired default behavior
  const indexImportPath = [dirname, basename, 'index'].join('/')
  const resolvedFile = resolveFile(
    path.resolve(path.dirname(filename), indexImportPath),
  )

  if (resolvedFile) {
    return resolvedFile
  } else {
    // No index file found, so try to import the directory-named-module instead
    const dirnameImportPath = [dirname, basename, basename].join('/')

    const resolvedPath = path.resolve(path.dirname(filename), dirnameImportPath)
    const dirnameResolvedFile = resolveFile(resolvedPath)

    if (dirnameResolvedFile) {
      return dirnameResolvedFile
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

      // We only need this plugin when the module could not be found
      const resolvedPath = path.resolve(path.dirname(importer), id)
      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath)

        if (stats.isFile()) {
          return null
        }
      }

      const newPath = getNewPath(id, importer)
      if (!newPath) {
        return null
      }

      // Convert to absolute path
      const resolvedDirnamePath = path.resolve(path.dirname(importer), newPath)

      return resolvedDirnamePath
    },
  }
}
