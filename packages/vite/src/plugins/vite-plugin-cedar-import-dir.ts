import fs from 'node:fs'
import path from 'node:path'

import { parse, Lang } from '@ast-grep/napi'
import MagicString from 'magic-string'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { importStatementPath, getPaths } from '@cedarjs/project-config'

/**
 * This Vite plugin will search for import statements that include a glob double
 * star `**` in the source part of the statement. The files that are matched are
 * imported and appended to an object.
 *
 * @example
 * Given a directory "src/services" that contains "a.js", "b.ts" and
 * "nested/c.js" will produce the following results:
 * ```js
 * import services from 'src/services/**\/*.{js,ts}'
 * console.log(services)
 * // services.a = import('src/services/a')
 * // services.b = import('src/services/b')
 * // services.nested_c = import('src/services/nested/c')
 * ```
 */
export function cedarImportDirPlugin(): Plugin {
  return {
    name: 'vite-plugin-cedar-import-dir',
    enforce: 'pre',
    async transform(code, id) {
      // Check if the code contains import statements with glob patterns
      if (!code.includes('/**/')) {
        return null
      }

      const ext = path.extname(id)
      const language =
        ext === '.ts' || ext === '.tsx' ? Lang.TypeScript : Lang.JavaScript

      let ast
      try {
        ast = parse(language, code)
      } catch (error) {
        console.warn('Failed to parse file:', id)
        console.warn(error)
        return null
      }

      const root = ast.root()
      let hasTransformations = false
      const s = new MagicString(code)

      // Find all import statements with glob patterns
      const globImports = root.findAll({
        rule: {
          pattern: 'import $DEFAULT_IMPORT from $SOURCE',
        },
      })

      for (const importNode of globImports) {
        const sourceNode = importNode.getMatch('SOURCE')
        const defaultImportNode = importNode.getMatch('DEFAULT_IMPORT')

        if (!sourceNode || !defaultImportNode) {
          continue
        }

        // Remove quotes
        const sourceValue = sourceNode.text().slice(1, -1)
        if (!sourceValue.includes('/**/')) {
          continue
        }

        hasTransformations = true
        const importName = defaultImportNode.text()

        const importGlob = importStatementPath(sourceValue)
        let cwd = path.dirname(id)

        // If the file location is inside the api workspace, resolve `src/`
        // paths against the api base path
        // If the file location is inside the web workspace, resolve `src/`
        // paths against the web base path
        if (importGlob.startsWith('src/')) {
          const normalizedId = normalizePath(id)
          const apiBase = normalizePath(getPaths().api.base)
          const webBase = normalizePath(getPaths().web.base)

          if (normalizedId.startsWith(apiBase)) {
            cwd = getPaths().api.base
          } else if (normalizedId.startsWith(webBase)) {
            cwd = getPaths().web.base
          } else {
            throw new Error(`Unexpected file location: ${id}`)
          }
        }

        try {
          const dirFiles = fs.globSync(importGlob, {
            cwd,
            exclude: (n) =>
              n.includes('.test.') ||
              n.includes('.scenarios.') ||
              n.includes('.d.ts'),
          })

          const staticGlob = importGlob.split('*')[0]
          const filePathToVarName = (filePath: string) => {
            const normalizedPath = normalizePath(filePath)
            return normalizedPath
              .replace(staticGlob, '')
              .replace(/\.(js|ts)$/, '')
              .replace(/[^a-zA-Z0-9]/g, '_')
          }

          // Build the replacement code
          let replacement = `let ${importName} = {};\n`

          // Generate namespace imports and assignments for each file
          for (const filePath of dirFiles) {
            const normalizedPath = normalizePath(filePath)
            const lastSlash = normalizedPath.lastIndexOf('/')
            const fileDir =
              lastSlash >= 0 ? normalizedPath.slice(0, lastSlash) : ''
            const fileName = normalizedPath
              .slice(lastSlash + 1)
              .replace(/\.\w+$/, '')
            const fileImportPath = fileDir ? fileDir + '/' + fileName : fileName
            const filePathVarName = filePathToVarName(filePath)
            const namespaceImportName = `${importName}_${filePathVarName}`

            // Create namespace import
            replacement += `import * as ${namespaceImportName} from '${fileImportPath}';\n`

            // Create assignment
            replacement += `${importName}.${filePathVarName} = ${namespaceImportName};\n`
          }

          // Overwrite the entire import statement with the replacement
          const range = importNode.range()
          s.overwrite(range.start.index, range.end.index, replacement.trim())
        } catch (error) {
          // If there's an error with glob matching, keep the original import
          console.warn(`Failed to process glob import: ${sourceValue}`, error)
        }
      }

      // Only return transformed code if we actually made changes
      if (hasTransformations) {
        return {
          code: s.toString(),
          map: s.generateMap({ hires: true }),
        }
      }

      return null
    },
  }
}
