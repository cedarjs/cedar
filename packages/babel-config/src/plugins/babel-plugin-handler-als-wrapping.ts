import type { PluginObj, types } from '@babel/core'

// This wraps user API functions to ensure context isolation has been performed. This should already
// be done at the request level but in serverless environments like Netlify we need to do
// this at the function level as a safeguard.

function generateWrappedHandler(t: typeof types, isAsync: boolean) {
  const contextStoreVariableDeclaration = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('__cedar_contextStore'),
      t.callExpression(
        t.memberExpression(
          t.callExpression(t.identifier('__cedar_getAsyncStoreInstance'), []),
          t.identifier('getStore'),
        ),
        [],
      ),
    ),
  ])
  t.addComment(
    contextStoreVariableDeclaration,
    'leading',
    ' The store will be undefined if no context isolation has been performed yet',
    true,
  )
  return t.arrowFunctionExpression(
    [t.identifier('__cedar_event'), t.identifier('__cedar_context')],
    t.blockStatement([
      contextStoreVariableDeclaration,
      t.ifStatement(
        t.binaryExpression(
          '===',
          t.identifier('__cedar_contextStore'),
          t.identifier('undefined'),
        ),
        t.blockStatement([
          t.returnStatement(
            t.callExpression(
              t.memberExpression(
                t.callExpression(
                  t.identifier('__cedar_getAsyncStoreInstance'),
                  [],
                ),
                t.identifier('run'),
              ),
              [
                t.newExpression(t.identifier('Map'), []),
                t.identifier('__cedar_handler'),
                t.identifier('__cedar_event'),
                t.identifier('__cedar_context'),
              ],
            ),
          ),
        ]),
      ),
      t.returnStatement(
        t.callExpression(t.identifier('__cedar_handler'), [
          t.identifier('__cedar_event'),
          t.identifier('__cedar_context'),
        ]),
      ),
    ]),
    isAsync,
  )
}

export default function (
  { types: t }: { types: typeof types },
  { projectIsEsm = false }: { projectIsEsm?: boolean } = {},
): PluginObj {
  return {
    name: 'babel-plugin-handler-als-wrapping',
    visitor: {
      ExportNamedDeclaration(path, _state) {
        // Confirm we're at the "handler" export
        const declaration = path.node.declaration
        if (!t.isVariableDeclaration(declaration)) {
          return
        }
        const identifier = declaration.declarations[0].id
        if (!t.isIdentifier(identifier)) {
          return
        }
        if (identifier.name !== 'handler') {
          return
        }

        // Import the context package
        const parentNode = path.parentPath.node
        if (!t.isProgram(parentNode)) {
          // This should be unreachable
          return
        }
        path.insertBefore(
          // import { getAsyncStoreInstance as __cedar_getAsyncStoreInstance } from '@cedarjs/context/dist/store'
          t.importDeclaration(
            [
              t.importSpecifier(
                t.identifier('__cedar_getAsyncStoreInstance'),
                t.identifier('getAsyncStoreInstance'),
              ),
            ],
            t.stringLiteral(
              projectIsEsm
                ? '@cedarjs/context/dist/store.js'
                : '@cedarjs/context/dist/store',
            ),
          ),
        )

        // Copy the original handler function to a new renamed function
        path.insertBefore(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier('__cedar_handler'),
              declaration.declarations[0].init,
            ),
          ]),
        )

        // Attempt to determine if we should mark the handler as async
        let isAsync = false
        const originalInit = declaration.declarations[0].init
        if (t.isFunction(originalInit)) {
          isAsync = originalInit.async
        }

        // Update the original handler to check the context status and call the renamed function
        declaration.declarations[0].init = generateWrappedHandler(t, isAsync)
      },
    },
  }
}
