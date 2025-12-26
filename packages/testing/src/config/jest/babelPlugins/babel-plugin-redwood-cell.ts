import { parse } from 'node:path'

import type { PluginObj, PluginPass } from '@babel/core'
import type * as t from '@babel/types'

// This wraps a file that has a suffix of `Cell` in Redwood's `createCell` higher
// order component. The HOC deals with the lifecycle methods during a GraphQL query.
//
// ```js
// import { createCell } from '@cedarjs/web'
// <YOUR CODE>
// export default createCell({ QUERY, Loading, Success, Failure, isEmpty, Empty, beforeQuery, afterQuery, displayName })
// ```
//
// To debug the output of the plugin, you can use the following:
// ```
// import generate from '@babel/generator'
// // ...
// console.log(generate(path.node).code)
// ```

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

type ExpectedExport = (typeof EXPECTED_EXPORTS_FROM_CELL)[number]

function isExpectedExport(name: string | undefined): name is ExpectedExport {
  return name !== undefined && EXPECTED_EXPORTS_FROM_CELL.includes(name)
}

interface PluginState extends PluginPass {
  // This array will collect exports from the Cell file during
  // ExportNamedDeclaration
  // - collected exports will then be passed to `createCell`
  // - The array is reset every time we `enter` a new Program
  exportNames: string[]
  hasDefaultExport: boolean
}

export default function ({
  types,
}: {
  types: typeof t
}): PluginObj<PluginState> {
  return {
    name: 'babel-plugin-redwood-cell',
    visitor: {
      ExportDefaultDeclaration(path, state) {
        state.hasDefaultExport = true
      },
      ExportNamedDeclaration(path, state) {
        const declaration = path.node.declaration

        if (!declaration) {
          return
        }

        let name: string | undefined

        if (declaration.type === 'VariableDeclaration') {
          const id = declaration.declarations[0].id
          if (id.type === 'Identifier') {
            name = id.name
          }
        }

        if (declaration.type === 'FunctionDeclaration') {
          name = declaration?.id?.name
        }

        if (isExpectedExport(name)) {
          state.exportNames.push(name)
        }
      },
      Program: {
        enter(_path, state) {
          // Reset variables as they're still in scope from the previous file
          // babel transformed in the same process
          state.exportNames = []
          state.hasDefaultExport = false
        },
        exit(path, state) {
          const hasQueryOrDataExport =
            state.exportNames.includes('QUERY') ||
            state.exportNames.includes('data')

          // If the file already has a default export then
          //   1. It's likely not a cell, or it's a cell that's already been
          //      wrapped in `createCell`
          //   2. If we added another default export we'd be breaking JS module
          //      rules. There can only be one default export.
          // If there's no `QUERY` or `data` export it's not a valid cell
          if (state.hasDefaultExport || !hasQueryOrDataExport) {
            return
          }

          // TODO (RSC): When we want to support `data = async () => {}` in
          // client cells as well, we'll need a different heuristic here
          // If we want to support `QUERY` (gql) cells on the server we'll
          // also need a different heuristic
          const createCellHookName = state.exportNames.includes('data')
            ? 'createServerCell'
            : 'createCell'
          const importFrom = state.exportNames.includes('data')
            ? '@cedarjs/web/dist/components/cell/createServerCell'
            : '@cedarjs/web'

          // Insert at the top of the file:
          // + import { createCell } from '@cedarjs/web'
          path.node.body.unshift(
            types.importDeclaration(
              [
                types.importSpecifier(
                  types.identifier(createCellHookName),
                  types.identifier(createCellHookName),
                ),
              ],
              types.stringLiteral(importFrom),
            ),
          )

          const objectProperties = [
            ...state.exportNames.map((name) =>
              types.objectProperty(
                types.identifier(name),
                types.identifier(name),
                false,
                true,
              ),
            ),
          ]

          // Add the `displayName` property only if we have a filename
          if (state.file.opts.filename) {
            objectProperties.push(
              types.objectProperty(
                types.identifier('displayName'),
                types.stringLiteral(parse(state.file.opts.filename).name),
                false,
                true,
              ),
            )
          }

          // Insert at the bottom of the file:
          // + export default createCell({ QUERY?, Loading?, Success?, Failure?, Empty?, beforeQuery?, isEmpty, afterQuery?, displayName? })
          path.node.body.push(
            types.exportDefaultDeclaration(
              types.callExpression(types.identifier(createCellHookName), [
                types.objectExpression(objectProperties),
              ]),
            ),
          )
        },
      },
    },
  }
}
