import fs from 'node:fs'
import path from 'node:path'

import babelGenerator from '@babel/generator'
import { parse as babelParse } from '@babel/parser'
import type { ParserPlugin } from '@babel/parser'
import babelTraverse from '@babel/traverse'
import type { types } from '@babel/core'
import * as t from '@babel/types'
import fg from 'fast-glob'
import { parse as graphqlParse, Kind } from 'graphql'
import type { Plugin } from 'vite'

// Handle default export interop for CommonJS/ESM dual usage
const traverse = (babelTraverse as any).default ?? babelTraverse
const generate = (babelGenerator as any).default ?? babelGenerator

/**
 * Vite plugin that automatically wraps the `standard` export in Cell mock files
 * with `mockGraphQLQuery`.
 *
 * Only active in non-production environments (for Storybook and Jest).
 *
 * Transforms `*.Cell.mock.[js,ts]` files by:
 * 1. Determining the query operation name from the adjacent Cell's QUERY export
 * 2. Wrapping the `standard` function export in `mockGraphQLQuery(operationName, fn)`
 * 3. If the Cell has an `afterQuery` export, also wraps with `afterQuery(fn())`
 *
 * This is a 1:1 port of `babel-plugin-redwood-mock-cell-data`.
 */
export function cedarMockCellDataPlugin(): Plugin {
  return {
    name: 'cedar-mock-cell-data',
    transform(code: string, id: string) {
      // Only process *.Cell.mock.{js,ts} files (not .jsx/.tsx — matches original pattern)
      if (!id.match(/.+Cell\.mock\.(js|ts)$/)) {
        return null
      }

      // Only required for storybook and jest (skip in production)
      if (process.env.NODE_ENV === 'production') {
        return null
      }

      const ast = parse(id, code)
      if (!ast) {
        return null
      }

      let pathsToRemove: any[] = []
      const nodesToInsert: t.Statement[] = []

      traverse(ast, {
        ExportNamedDeclaration(p: any) {
          const d = p.node.declaration
          let mockFunction:
            | t.ArrowFunctionExpression
            | t.FunctionExpression
            | null = null

          switch (d?.type) {
            case 'VariableDeclaration': {
              const standardMockExport = d.declarations[0]
              const exportId = standardMockExport.id as t.Identifier
              const exportName = exportId?.name

              if (exportName !== 'standard') {
                return
              }

              const mockFunctionMaybe = standardMockExport?.init
              if (!mockFunctionMaybe) {
                return
              }

              if (
                mockFunctionMaybe.type !== 'ArrowFunctionExpression' &&
                mockFunctionMaybe.type !== 'FunctionExpression'
              ) {
                throw new Error(
                  `\n \n Mock Error: You must export your standard mock as a function \n \n`,
                )
              }

              mockFunction = mockFunctionMaybe
              break
            }

            case 'FunctionDeclaration': {
              const exportName = d.id?.name

              if (exportName !== 'standard') {
                return
              }

              // Convert named function to arrow function
              mockFunction = t.arrowFunctionExpression(d.params, d.body)
              break
            }

            default:
              return
          }

          // Find the Cell in the same directory
          const dirname = path.dirname(id)
          const cellName = path.basename(dirname)

          const [cellPath] = fg.sync(`${cellName}.{js,jsx,ts,tsx}`, {
            cwd: dirname,
            absolute: true,
            ignore: ['node_modules'],
          })

          if (!cellPath) {
            return
          }

          // Register the Cell file as a dependency so HMR works when the Cell changes
          this.addWatchFile(cellPath)

          const cellMetadata = getCellMetadata(cellPath)

          if (cellMetadata.hasDefaultExport || !cellMetadata.hasQueryExport) {
            return
          }

          // Warn if the QUERY operation is anonymous (no operation name)
          if (!cellMetadata.operationName) {
            console.warn(
              `[cedar-mock-cell-data] Cell ${cellPath} has an unnamed GraphQL operation. ` +
                `The mock for ${id} will not work. ` +
                `Ensure the QUERY is named, e.g., "query GetUser { ... }"`,
            )
            return
          }

          // mockGraphQLQuery(<operationName>, <mockFunction>)
          const mockGraphQLCall = t.callExpression(
            t.identifier('mockGraphQLQuery'),
            [
              t.stringLiteral(cellMetadata.operationName),
              mockFunction as t.ArrowFunctionExpression | t.FunctionExpression,
            ],
          )

          pathsToRemove = [...pathsToRemove, p]

          if (cellMetadata.hasAfterQueryExport) {
            const importAfterQuery = t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier('afterQuery'),
                  t.identifier('afterQuery'),
                ),
              ],
              t.stringLiteral(`./${path.basename(cellPath)}`),
            )

            nodesToInsert.push(
              importAfterQuery,
              createExportStandard(
                t,
                t.arrowFunctionExpression(
                  [],
                  t.callExpression(t.identifier('afterQuery'), [
                    t.callExpression(mockGraphQLCall, []),
                  ]),
                ),
              ),
            )
          } else {
            nodesToInsert.push(createExportStandard(t, mockGraphQLCall))
          }
        },
      })

      if (nodesToInsert.length === 0) {
        return null
      }

      // Remove old nodes (using Babel path.remove())
      for (const p of pathsToRemove) {
        p.remove()
      }

      // Insert at the top
      ;(ast as any).program.body.unshift(...nodesToInsert)

      const result = generate(ast, { retainLines: false }, code)
      return {
        code: result.code,
        map: result.map,
      }
    },
  }
}

// export const standard = ${ex}
function createExportStandard(
  t: typeof import('@babel/types'),
  ex: t.CallExpression | t.ArrowFunctionExpression,
): t.ExportNamedDeclaration {
  return t.exportNamedDeclaration(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier('standard'), ex),
    ]),
  )
}

export const getCellMetadata = (p: string) => {
  const ast = getCellAst(p)

  let hasDefaultExport = false
  const namedExports: NamedExports[] = []
  let operation: string | undefined

  traverse(ast, {
    ExportDefaultDeclaration() {
      hasDefaultExport = true
    },
    ExportNamedDeclaration(path: any) {
      const specifiers = path.node?.specifiers

      if (specifiers.length) {
        for (const s of specifiers) {
          const id = s.exported as types.Identifier
          namedExports.push({
            name: id.name,
            type: 're-export',
          })
        }
        return
      }

      const declaration = path.node.declaration

      if (!declaration) {
        return
      }

      if (declaration.type === 'VariableDeclaration') {
        const id = declaration.declarations[0].id as types.Identifier
        namedExports.push({
          name: id.name,
          type: 'variable',
        })
      } else if (declaration.type === 'FunctionDeclaration') {
        namedExports.push({
          name: declaration?.id?.name as string,
          type: 'function',
        })
      } else if (declaration.type === 'ClassDeclaration') {
        namedExports.push({
          name: declaration?.id?.name as string,
          type: 'class',
        })
      }
    },
    TaggedTemplateExpression(path: any) {
      if (path.parent?.id?.name !== 'QUERY') {
        return
      }
      operation = path.node.quasi.quasis[0].value.raw
    },
  })

  const hasQueryExport = namedExports.find(({ name }) => name === 'QUERY')
  const hasAfterQueryExport = namedExports.find(
    ({ name }) => name === 'afterQuery',
  )

  let operationName = ''

  if (operation) {
    const document = graphqlParse(operation)

    for (const definition of document.definitions) {
      if (
        definition.kind === Kind.OPERATION_DEFINITION &&
        definition.name?.value
      ) {
        operationName = definition.name.value
      }
    }
  }

  return {
    hasDefaultExport,
    namedExports,
    hasQueryExport,
    hasAfterQueryExport,
    operationName,
  }
}

function getCellAst(filePath: string): t.File {
  const code = fs.readFileSync(filePath, 'utf-8')
  const plugins = ['typescript', 'jsx'].filter(Boolean) as ParserPlugin[]

  try {
    return babelParse(code, {
      sourceType: 'module',
      plugins,
    })
  } catch (e: any) {
    console.error(`Error parsing: ${filePath}`)
    console.error(e)
    throw new Error(e?.message)
  }
}

function parse(filePath: string, code: string): t.File | null {
  const plugins = ['typescript', 'jsx'].filter(Boolean) as ParserPlugin[]
  try {
    return babelParse(code, {
      sourceType: 'module',
      plugins,
    })
  } catch (e: any) {
    console.error(`Error parsing: ${filePath}`)
    console.error(e)
    return null
  }
}

interface NamedExports {
  name: string
  type: 're-export' | 'variable' | 'function' | 'class'
}
