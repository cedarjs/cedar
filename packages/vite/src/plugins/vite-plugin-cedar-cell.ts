import { parse as parsePath } from 'node:path'

import babelGenerator from '@babel/generator'
import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import type * as t from '@babel/types'
import type { Plugin } from 'vite'

const traverse = babelTraverse.default || babelTraverse
const generate = babelGenerator.default || babelTraverse

// A cell can export the declarations below.
const EXPECTED_EXPORTS_FROM_CELL = [
  'beforeQuery',
  'QUERY',
  'data',
  'isEmpty',
  'afterQuery',
  'Loading',
  'Success',
  'Failure',
  'Empty',
]

/**
 * Vite plugin that wraps files with a suffix of `Cell` in CedarJS's `createCell`
 * higher order component. The HOC deals with the lifecycle methods during a GraphQL query.
 *
 * This transforms:
 * ```js
 * export const QUERY = gql`...`
 * export const Loading = () => <div>Loading...</div>
 * export const Success = ({ data }) => <div>{data}</div>
 * ```
 *
 * Into:
 * ```js
 * import { createCell } from '@cedarjs/web'
 * export const QUERY = gql`...`
 * export const Loading = () => <div>Loading...</div>
 * export const Success = ({ data }) => <div>{data}</div>
 * export default createCell({ QUERY, Loading, Success, displayName: 'MyCell' })
 * ```
 */
export function cedarCellTransform(): Plugin {
  return {
    name: 'vite-plugin-cedar-cell',
    transform(code: string, id: string) {
      // Only process files that end with 'Cell' (e.g., UserCell.tsx, PostCell.js)
      if (!id.match(/Cell\.[jt]sx?$/)) {
        return null
      }

      try {
        // Parse the code into an AST
        const ast = parse(code, {
          sourceType: 'module',
          plugins: [
            'jsx',
            'typescript',
            'decorators-legacy',
            'classProperties',
            'objectRestSpread',
            'asyncGenerators',
            'functionBind',
            'exportDefaultFrom',
            'exportNamespaceFrom',
            'dynamicImport',
            'nullishCoalescingOperator',
            'optionalChaining',
          ],
        })

        const exportNames: string[] = []
        let hasDefaultExport = false

        // Traverse the AST to collect export information
        traverse(ast, {
          ExportDefaultDeclaration() {
            hasDefaultExport = true
          },
          ExportNamedDeclaration(path) {
            const declaration = path.node.declaration

            if (!declaration) {
              return
            }

            let name: string | undefined
            if (declaration.type === 'VariableDeclaration') {
              const id = declaration.declarations[0].id as t.Identifier
              name = id.name
            }
            if (declaration.type === 'FunctionDeclaration') {
              name = declaration?.id?.name
            }

            if (name && EXPECTED_EXPORTS_FROM_CELL.includes(name)) {
              exportNames.push(name)
            }
          },
        })

        const hasQueryOrDataExport =
          exportNames.includes('QUERY') || exportNames.includes('data')

        // If the file already has a default export then
        //   1. It's likely not a cell, or it's a cell that's already been
        //      wrapped in `createCell`
        //   2. If we added another default export we'd be breaking JS module
        //      rules. There can only be one default export.
        // If there's no `QUERY` or `data` export it's not a valid cell
        if (hasDefaultExport || !hasQueryOrDataExport) {
          return null
        }

        // Determine which create function to use based on exports
        const createCellHookName = exportNames.includes('data')
          ? 'createServerCell'
          : 'createCell'
        const importFrom = exportNames.includes('data')
          ? '@cedarjs/web/dist/components/cell/createServerCell'
          : '@cedarjs/web'

        // Transform the AST
        traverse(ast, {
          Program(path) {
            // Insert import at the top of the file
            const importDeclaration = {
              type: 'ImportDeclaration' as const,
              specifiers: [
                {
                  type: 'ImportSpecifier' as const,
                  imported: {
                    type: 'Identifier' as const,
                    name: createCellHookName,
                  },
                  local: {
                    type: 'Identifier' as const,
                    name: createCellHookName,
                  },
                },
              ],
              source: { type: 'StringLiteral' as const, value: importFrom },
            }
            path.node.body.unshift(importDeclaration as any)

            // Create the object properties for the createCell call
            const objectProperties = [
              ...exportNames.map((name) => ({
                type: 'ObjectProperty' as const,
                key: { type: 'Identifier' as const, name },
                value: { type: 'Identifier' as const, name },
                shorthand: true,
                computed: false,
              })),
              // Add the displayName property
              {
                type: 'ObjectProperty' as const,
                key: { type: 'Identifier' as const, name: 'displayName' },
                value: {
                  type: 'StringLiteral' as const,
                  value: parsePath(id).name,
                },
                shorthand: false,
                computed: false,
              },
            ]

            // Insert export default at the bottom of the file
            const exportDefaultDeclaration = {
              type: 'ExportDefaultDeclaration' as const,
              declaration: {
                type: 'CallExpression' as const,
                callee: {
                  type: 'Identifier' as const,
                  name: createCellHookName,
                },
                arguments: [
                  {
                    type: 'ObjectExpression' as const,
                    properties: objectProperties,
                  },
                ],
              },
            }
            path.node.body.push(exportDefaultDeclaration as any)
          },
        })

        // Generate the transformed code
        const result = generate(ast, {
          retainLines: true,
          compact: false,
        })

        return {
          code: result.code,
          map: result.map,
        }
      } catch (error) {
        // If parsing fails, return the original code
        console.warn(`Failed to transform Cell file ${id}:`, error)
        return null
      }
    },
  }
}
