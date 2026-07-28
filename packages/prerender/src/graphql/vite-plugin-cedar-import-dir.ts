import path from 'node:path'

import fg from 'fast-glob'
import MagicString from 'magic-string'
import { parseSync } from 'oxc-parser'
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

      let program
      try {
        program = parseSync(id, code).program
      } catch (error) {
        console.warn('Failed to parse file:', id)
        console.warn(error)
        return null
      }

      let hasTransformations = false
      const s = new MagicString(code)

      // Find all default-import statements with glob patterns
      for (const node of program.body) {
        if (node.type !== 'ImportDeclaration') {
          continue
        }

        const defaultSpecifier = node.specifiers.find(
          (specifier) => specifier.type === 'ImportDefaultSpecifier',
        )
        if (!defaultSpecifier) {
          continue
        }

        const sourceValue = node.source.value
        if (!sourceValue.includes('/**/')) {
          continue
        }

        hasTransformations = true
        const importName = defaultSpecifier.local.name

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

          // Overwrite the entire import statement with the replacement
          s.overwrite(node.start, node.end, replacement.trim())
        } catch (error) {
          // If there's an error with glob matching, keep the original import
          console.warn(`Failed to process glob import: ${sourceValue}`, error)
        }
      }

      // Only return transformed code if we actually made changes
      if (hasTransformations) {
        return {
          code: s.toString(),
          map: null, // For simplicity, not generating source maps
        }
      }

      return null
    },
  }
}
