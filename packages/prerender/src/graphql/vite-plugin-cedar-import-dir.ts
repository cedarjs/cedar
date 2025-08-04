import path from 'node:path'

import * as swc from '@swc/core'
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
  const createSpan = (): swc.Span => ({
    start: 0,
    end: 0,
    // ctxt is not actually used, I just have to add it because of broken swc
    // types, see https://github.com/Menci/vite-plugin-top-level-await/issues/52
    ctxt: 0,
  })

  const createIdentifier = (value: string, ctxt: number): swc.Identifier => ({
    type: 'Identifier',
    span: createSpan(),
    // @ts-expect-error - See https://github.com/Menci/vite-plugin-top-level-await/issues/52
    ctxt,
    value,
    optional: false,
    typeAnnotation: null,
  })

  const createStringLiteral = (value: string): swc.StringLiteral => ({
    type: 'StringLiteral',
    span: createSpan(),
    value,
    raw: `'${value}'`,
  })

  return {
    name: 'vite-plugin-cedar-import-dir',
    enforce: 'pre',
    async transform(code, id) {
      // Check if the code contains import statements with glob patterns
      if (!code.includes('/**/')) {
        return null
      }

      const ext = path.extname(id)
      const ast = await swc.parse(code, {
        syntax: ext === '.ts' || ext === '.tsx' ? 'typescript' : 'ecmascript',
        tsx: ext === '.tsx',
      })

      let hasTransformations = false
      const newBody: swc.ModuleItem[] = []

      // Extract ctxt from the first item in the AST for consistent context
      // @ts-expect-error - See https://github.com/Menci/vite-plugin-top-level-await/issues/52
      const ctxt = ast.body.length > 0 ? ast.body[0].ctxt || 0 : 0

      for (const item of ast.body) {
        if (
          item.type === 'ImportDeclaration' &&
          item.source.value.includes('/**/')
        ) {
          hasTransformations = true

          // Get the import name from the default import specifier
          const defaultSpecifier = item.specifiers.find(
            (spec): spec is swc.ImportDefaultSpecifier =>
              spec.type === 'ImportDefaultSpecifier',
          )

          if (!defaultSpecifier) {
            // If no default specifier, keep original import
            newBody.push(item)
            continue
          }

          const importName = defaultSpecifier.local.value
          const importPath = item.source.value

          const importGlob = importStatementPath(importPath)
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

            // Create variable declaration: let importName = {}
            newBody.push({
              type: 'VariableDeclaration',
              span: createSpan(),
              // @ts-expect-error - See https://github.com/Menci/vite-plugin-top-level-await/issues/52
              ctxt,
              kind: 'let',
              declare: false,
              declarations: [
                {
                  type: 'VariableDeclarator',
                  span: createSpan(),
                  id: createIdentifier(importName, ctxt),
                  init: {
                    type: 'ObjectExpression',
                    span: createSpan(),
                    properties: [],
                  },
                  definite: false,
                },
              ],
            })

            // Process each matched file
            for (const filePath of dirFiles) {
              const { dir: fileDir, name: fileName } = path.parse(filePath)
              const fileImportPath = fileDir + '/' + fileName
              const filePathVarName = filePathToVarName(filePath)
              const namespaceImportName = `${importName}_${filePathVarName}`

              // Create namespace import: import * as importName_filePathVarName from 'fileImportPath'
              // I'm generating extensionless imports here and let the rest of
              // the plugin pipeline handle the extension.
              newBody.push({
                type: 'ImportDeclaration',
                span: createSpan(),
                specifiers: [
                  {
                    type: 'ImportNamespaceSpecifier',
                    span: createSpan(),
                    local: createIdentifier(namespaceImportName, ctxt),
                  },
                ],
                source: createStringLiteral(fileImportPath),
                typeOnly: false,
              })

              // Create assignment: importName.filePathVarName = importName_filePathVarName
              newBody.push({
                type: 'ExpressionStatement',
                span: createSpan(),
                expression: {
                  type: 'AssignmentExpression',
                  span: createSpan(),
                  operator: '=',
                  left: {
                    type: 'MemberExpression',
                    span: createSpan(),
                    object: createIdentifier(importName, ctxt),
                    property: createIdentifier(filePathVarName, ctxt),
                  },
                  right: createIdentifier(namespaceImportName, ctxt),
                },
              })
            }
          } catch (error) {
            // If there's an error with glob matching, keep the original import
            console.warn(`Failed to process glob import: ${importPath}`, error)
            newBody.push(item)
          }
        } else {
          // Keep non-glob imports as-is
          newBody.push(item)
        }
      }

      // Only return transformed code if we actually made changes
      if (hasTransformations) {
        const transformedAst: swc.Module = {
          ...ast,
          body: newBody,
        }

        const output = await swc.print(transformedAst, {
          minify: false,
        })

        return {
          code: output.code,
          map: null, // For simplicity, not generating source maps
        }
      }

      return null
    },
  }
}
