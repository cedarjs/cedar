import path from 'node:path'

import { parse, Lang } from '@ast-grep/napi'
import fg from 'fast-glob'
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
      const edits = []

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

        const sourceValue = sourceNode.text().slice(1, -1) // Remove quotes
        if (!sourceValue.includes('/**/')) {
          continue
        }

        hasTransformations = true
        const importName = defaultImportNode.text()

        const importGlob = importStatementPath(sourceValue)
        const cwd = importGlob.startsWith('src/')
          ? getPaths().api.base
          : path.dirname(id)

        try {
          const dirFiles = fg
            .sync(importGlob, { cwd })
            // Ignore *.test.*, *.scenarios.* and *.d.ts files
            .filter(
              (n) =>
                !n.includes('.test.') &&
                !n.includes('.scenarios.') &&
                !n.includes('.d.ts'),
            )

          const staticGlob = importGlob.split('*')[0]
          const filePathToVarName = (filePath: string) => {
            return filePath
              .replace(staticGlob, '')
              .replace(/\.(js|ts)$/, '')
              .replace(/[^a-zA-Z0-9]/g, '_')
          }

          // Build the replacement code
          let replacement = `let ${importName} = {};\n`

          // Generate namespace imports and assignments for each file
          for (const filePath of dirFiles) {
            const { dir: fileDir, name: fileName } = path.parse(filePath)
            const fileImportPath = fileDir + '/' + fileName
            const filePathVarName = filePathToVarName(filePath)
            const namespaceImportName = `${importName}_${filePathVarName}`

            // Create namespace import
            replacement += `import * as ${namespaceImportName} from '${fileImportPath}';\n`

            // Create assignment
            replacement += `${importName}.${filePathVarName} = ${namespaceImportName};\n`
          }

          // Create edit to replace the entire import statement
          edits.push(importNode.replace(replacement.trim()))
        } catch (error) {
          // If there's an error with glob matching, keep the original import
          console.warn(`Failed to process glob import: ${sourceValue}`, error)
        }
      }

      // Only return transformed code if we actually made changes
      if (hasTransformations && edits.length > 0) {
        const transformedCode = root.commitEdits(edits)

        return {
          code: transformedCode,
          map: null, // For simplicity, not generating source maps
        }
      }

      return null
    },
  }
}
