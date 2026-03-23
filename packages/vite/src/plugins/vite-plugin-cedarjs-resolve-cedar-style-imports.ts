import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import type { Paths } from '@cedarjs/project-config'
import { getPaths, resolveFile } from '@cedarjs/project-config'

function resolveFromAbsolutePath(absolutePath: string) {
  const ext = path.extname(absolutePath)
  const pathToResolve = ext ? absolutePath.slice(0, -ext.length) : absolutePath

  const direct = resolveFile(pathToResolve)

  if (direct) {
    return direct
  }

  const indexFile = resolveFile(path.join(pathToResolve, 'index'))

  if (indexFile) {
    return indexFile
  }

  const dirNamedFile = resolveFile(
    path.join(pathToResolve, path.basename(pathToResolve)),
  )

  if (dirNamedFile) {
    return dirNamedFile
  }

  return null
}

export function cedarjsResolveCedarStyleImportsPlugin(): Plugin {
  let cedarPaths: Paths | undefined

  try {
    cedarPaths = getPaths()
  } catch {
    // getPaths() may throw in non-Cedar test environments
  }

  return {
    name: 'cedarjs-resolve-cedar-style-imports',

    resolveId(id: string, importer?: string) {
      // Skip if no importer (entry point) or if in node_modules
      if (!importer || importer.includes('/node_modules/')) {
        return null
      }

      // Handle src/ bare specifiers
      if (cedarPaths && id.startsWith('src/')) {
        const normalizedImporter = normalizePath(importer)
        const normalizedWebSrc = normalizePath(cedarPaths.web.src)
        const normalizedApiSrc = normalizePath(cedarPaths.api.src)

        let srcDir: string | undefined

        if (normalizedImporter.startsWith(normalizedWebSrc)) {
          srcDir = cedarPaths.web.src
        } else if (normalizedImporter.startsWith(normalizedApiSrc)) {
          srcDir = cedarPaths.api.src
        }

        if (srcDir) {
          const resolved = resolveFromAbsolutePath(
            path.join(srcDir, id.slice('src/'.length)),
          )

          if (resolved) {
            return resolved
          }
        }
      }

      // We only need this plugin when the module could not be found
      const resolvedPath = path.resolve(path.dirname(importer), id)

      if (fs.existsSync(resolvedPath)) {
        const stats = fs.statSync(resolvedPath)

        if (stats.isFile()) {
          return null
        }
      }

      const newPath = resolveFromAbsolutePath(resolvedPath)

      if (!newPath) {
        return null
      }

      return newPath
    },
  }
}
