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
  console.log('Index import path:', indexImportPath)
  const resolvedFile = resolveFile(
    path.resolve(path.dirname(filename), indexImportPath),
  )
  console.log('Resolved index file:', resolvedFile)

  if (resolvedFile) {
    // return indexImportPath
    return resolvedFile
  } else {
    // No index file found, so try to import the directory-named-module instead
    const dirnameImportPath = [dirname, basename, basename].join('/')
    console.log('Directory import path:', dirnameImportPath)

    const resolvedPath = path.resolve(path.dirname(filename), dirnameImportPath)
    console.log('Resolved path:', resolvedPath)
    const dirnameResolvedFile = resolveFile(resolvedPath)
    console.log('Resolved directory file:', dirnameResolvedFile)

    if (dirnameResolvedFile) {
      // return dirnameImportPath
      return dirnameResolvedFile
    }
  }

  return null
}

export function cedarjsDirectoryNamedImportPlugin(): Plugin {
  return {
    name: 'cedarjs-directory-named-import',

    resolveId(id: string, importer?: string) {
      console.log('resolveId called with id:', id, 'importer:', importer)
      // Skip if no importer (entry point) or if in node_modules
      if (!importer || importer.includes('/node_modules/')) {
        return null
      }

      // We only need this plugin when the module could not be found
      const resolvedPath = path.resolve(path.dirname(importer), id)
      console.log('Resolved path:', resolvedPath)
      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath)

        if (stats.isFile()) {
          return null
        }
      }

      const newPath = getNewPath(id, importer)
      console.log('New path:', newPath)
      if (!newPath) {
        return null
      }

      // Convert to absolute path for Rollup
      const resolvedDirnamePath = path.resolve(path.dirname(importer), newPath)

      return resolvedDirnamePath
    },
  }
}
