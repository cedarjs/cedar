import { parse as parsePath } from 'node:path'

import babelGenerator from '@babel/generator'
import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import type * as t from '@babel/types'
import type { Plugin } from 'vite'

// This plugin is used both by prerender (ESM) and vite (CJS in current Cedar
// apps), that's why we need to do this
const traverse = babelTraverse.default || babelTraverse
const generate = babelGenerator.default || babelGenerator

// A cell can export the declarations below.
const EXPECTED_EXPORTS_FROM_CELL = [
  'beforeQuery',
  'QUERY',
  'FRAGMENT',
  'data',
  'isEmpty',
  'afterQuery',
  'Loading',
  'Success',
  'Failure',
  'Empty',
]

/**
 * Check if a string is a valid JavaScript identifier.
 * Valid identifiers must start with a letter, underscore, or $, and can
 * contain only letters, digits, underscores, or $. ASCII only -- Cell
 * filenames are expected to be ASCII, this isn't meant to cover the full
 * ECMAScript identifier grammar (e.g. Unicode identifiers).
 */
function isValidIdentifier(name: string): boolean {
  const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
  return identifierRegex.test(name)
}

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
 * const MyCell = createCell({ QUERY, Loading, Success, displayName: 'MyCell' })
 * export default MyCell
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

      // Validate that the Cell filename is a valid JavaScript identifier
      // Extract the filename without extension (e.g., "UserCell" from "/path/to/UserCell.tsx")
      const cellComponentName = parsePath(id).name
      if (!isValidIdentifier(cellComponentName)) {
        throw new Error(
          `Cell filename "${cellComponentName}" must be a valid JavaScript identifier (PascalCase is recommended). ` +
            `Valid identifiers must start with a letter, underscore, or $ and contain only letters, digits, underscores, or $.`,
        )
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
        const existingBindings = new Set<string>()

        // Traverse the AST to collect export information and existing bindings
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
          // Collect existing top-level bindings (variables, functions, imports)
          VariableDeclaration(path) {
            if (path.parent.type === 'Program') {
              path.node.declarations.forEach((decl) => {
                if (decl.id.type === 'Identifier') {
                  existingBindings.add(decl.id.name)
                }
              })
            }
          },
          FunctionDeclaration(path) {
            if (path.parent.type === 'Program' && path.node.id) {
              existingBindings.add(path.node.id.name)
            }
          },
          ClassDeclaration(path) {
            if (path.parent.type === 'Program' && path.node.id) {
              existingBindings.add(path.node.id.name)
            }
          },
          ImportDeclaration(path) {
            path.node.specifiers.forEach((spec) => {
              if (spec.local.type === 'Identifier') {
                existingBindings.add(spec.local.name)
              }
            })
          },
        })

        const hasQueryOrDataExport =
          exportNames.includes('QUERY') ||
          exportNames.includes('FRAGMENT') ||
          exportNames.includes('data')

        // If the file already has a default export then
        //   1. It's likely not a cell, or it's a cell that's already been
        //      wrapped in `createCell`
        //   2. If we added another default export we'd be breaking JS module
        //      rules. There can only be one default export.
        // If there's no `QUERY`, `FRAGMENT` or `data` export it's not a valid
        // cell
        if (hasDefaultExport || !hasQueryOrDataExport) {
          return null
        }

        // Check for binding collisions: the Cell filename (which becomes the
        // component name) must not collide with existing declarations or imports
        if (existingBindings.has(cellComponentName)) {
          throw new Error(
            `Cell filename "${cellComponentName}" collides with an existing binding in the file. ` +
              `Rename the Cell file to use a unique identifier, or remove the conflicting binding.`,
          )
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
            path.node.body.unshift(importDeclaration)

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

            // Assign the `createCell(...)` call to a named `const` and
            // export that binding by reference, rather than exporting the
            // call expression directly as an anonymous default export.
            // React Fast Refresh requires a named binding to register a
            // component as an HMR boundary -- an anonymous default export
            // of a call expression is exactly the shape it declines to
            // handle, so editing a Cell would otherwise force a full
            // remount of the nearest refresh-eligible ancestor (typically
            // the Page), discarding any state held in the Cell's subtree.

            const cellVariableDeclaration = {
              type: 'VariableDeclaration' as const,
              kind: 'const' as const,
              declarations: [
                {
                  type: 'VariableDeclarator' as const,
                  id: {
                    type: 'Identifier' as const,
                    name: cellComponentName,
                  },
                  init: {
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
                },
              ],
            }
            path.node.body.push(cellVariableDeclaration)

            // Insert export default at the bottom of the file
            const exportDefaultDeclaration = {
              type: 'ExportDefaultDeclaration' as const,
              declaration: {
                type: 'Identifier' as const,
                name: cellComponentName,
              },
            }
            path.node.body.push(exportDefaultDeclaration)
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
        // Re-throw validation errors so they surface to the dev/build
        if (
          error instanceof Error &&
          (error.message.includes('collides with an existing binding') ||
            error.message.includes('must be a valid JavaScript identifier'))
        ) {
          throw error
        }
        // If parsing fails, return null
        console.warn(`Failed to transform Cell file ${id}:`, error)
        return null
      }
    },
  }
}
