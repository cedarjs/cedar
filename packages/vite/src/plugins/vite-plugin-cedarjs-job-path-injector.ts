import path from 'node:path'

import * as swc from '@swc/core'
import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

export function cedarjsJobPathInjectorPlugin(): Plugin {
  return {
    name: 'cedarjs-job-path-injector',
    transform(code, id) {
      // Quick check to see if this might be a job file
      if (!code.includes('createJob')) {
        return null
      }

      const isTypescript = id.endsWith('.ts') || id.endsWith('.tsx')

      let ast
      try {
        ast = swc.parseSync(code, {
          target: 'es2022',
          syntax: isTypescript ? 'typescript' : 'ecmascript',
          tsx: id.endsWith('.tsx'),
          jsx: id.endsWith('.jsx'),
        })
      } catch (error) {
        console.warn('Failed to parse file:', id)
        console.warn(error)

        // If we can't parse, just return the original code
        return null
      }

      const paths = getPaths()
      let hasModifications = false
      const modifications: {
        start: number
        end: number
        replacement: string
      }[] = []

      // Traverse the AST to find createJob calls
      function traverse(node: any) {
        if (!node || typeof node !== 'object') {
          return
        }

        // Look for export declarations
        if (node.type === 'ExportDeclaration' && node.declaration) {
          const declaration = node.declaration

          // Check if it's a variable declaration
          if (declaration.type === 'VariableDeclaration') {
            const declarator = declaration.declarations[0]

            if (declarator && declarator.type === 'VariableDeclarator') {
              const init = declarator.init

              // Check if it's a call expression
              if (init && init.type === 'CallExpression') {
                const callee = init.callee

                // Check if it's a member expression calling createJob
                if (callee && callee.type === 'MemberExpression') {
                  const property = callee.property

                  if (
                    property &&
                    property.type === 'Identifier' &&
                    property.value === 'createJob'
                  ) {
                    // We found a createJob call, let's inject the path and name
                    const variableId = declarator.id

                    if (variableId && variableId.type === 'Identifier') {
                      const importName = variableId.value
                      const importPath = path.relative(paths.api.jobs, id)
                      const importPathWithoutExtension = importPath.replace(
                        /\.[^/.]+$/,
                        '',
                      )

                      // Get the first argument (should be an object)
                      const firstArg = init.arguments[0]

                      if (firstArg?.expression?.type === 'ObjectExpression') {
                        // Find the end of the object properties to insert our new properties
                        const objectExpr = firstArg.expression
                        const properties = objectExpr.properties
                        let insertPosition: number

                        if (properties.length > 0) {
                          // Insert after the last property
                          const lastProperty = properties[properties.length - 1]
                          // SWC properties don't have direct span, calculate from key and value
                          if (lastProperty.type === 'KeyValueProperty') {
                            insertPosition = lastProperty.value.span.end
                          } else {
                            // Fallback: use the object's end minus 1 (before closing brace)
                            insertPosition = objectExpr.span.end - 1
                          }
                        } else {
                          // Empty object, insert after the opening brace
                          insertPosition = objectExpr.span.start + 1
                        }

                        // Build the properties to insert
                        const pathProperty = `path: ${JSON.stringify(importPathWithoutExtension)}`
                        const nameProperty = `name: ${JSON.stringify(importName)}`

                        let insertText = ''
                        if (properties.length > 0) {
                          insertText = `, ${pathProperty}, ${nameProperty}`
                        } else {
                          insertText = `${pathProperty}, ${nameProperty}`
                        }

                        modifications.push({
                          start: insertPosition,
                          end: insertPosition,
                          replacement: insertText,
                        })

                        hasModifications = true
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Recursively traverse child nodes
        for (const key in node) {
          if (
            key === 'parent' ||
            key === 'leadingComments' ||
            key === 'trailingComments' ||
            key === 'span'
          ) {
            continue
          }

          const child = node[key]
          if (Array.isArray(child)) {
            child.forEach(traverse)
          } else if (child && typeof child === 'object') {
            traverse(child)
          }
        }
      }

      traverse(ast)

      if (!hasModifications) {
        return null
      }

      // Apply modifications from end to start to avoid offset issues
      modifications.sort((a, b) => b.start - a.start)

      let modifiedCode = code
      for (const mod of modifications) {
        modifiedCode =
          modifiedCode.slice(0, mod.start) +
          mod.replacement +
          modifiedCode.slice(mod.end)
      }

      return {
        code: modifiedCode,
        map: null,
      }
    },
  }
}
