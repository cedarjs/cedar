import fs from 'node:fs'
import nodePath from 'node:path'

import type { NodePath, PluginObj, PluginPass, types } from '@babel/core'

import { getConfig, getPaths } from '@cedarjs/project-config'

/**
 * Babel plugin that injects the auto-generated gqlorm backend into
 * `api/src/functions/graphql.ts` at build time.
 *
 * When `experimental.gqlorm.enabled = true` and `.cedar/gqlorm/backend.ts`
 * exists, this plugin:
 *
 * 1. Adds imports at the top of graphql.ts:
 *      import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'
 *      import { db as __gqlorm_db__ } from 'src/lib/db'
 *
 * 2. Inserts a statement immediately before the `createGraphQLHandler` call:
 *      sdls = {
 *        ...sdls,
 *        __gqlorm__: {
 *          schema: __gqlorm_sdl__.schema,
 *          resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
 *        },
 *      }
 *
 * The `sdls` variable is already a `let` binding at this point because
 * `babel-plugin-redwood-import-dir` transforms the glob import
 * `import sdls from 'src/graphql/**\/*.sdl.{js,ts}'` into `let sdls = {}`.
 *
 * This plugin is a no-op when gqlorm is disabled or the backend file does
 * not exist.
 */
export default function ({ types: t }: { types: typeof types }): PluginObj {
  return {
    name: 'babel-plugin-cedar-gqlorm-inject',
    visitor: {
      Program(programPath: NodePath<types.Program>, state: PluginPass) {
        // No-op if gqlorm is disabled
        let config: ReturnType<typeof getConfig>
        try {
          config = getConfig()
        } catch {
          return
        }

        if (!config.experimental?.gqlorm?.enabled) {
          return
        }

        // No-op if the backend file does not exist
        let paths: ReturnType<typeof getPaths>
        try {
          paths = getPaths()
        } catch {
          return
        }

        const backendPathWithoutExt = nodePath.join(
          paths.generated.base,
          'gqlorm',
          'backend',
        )
        const backendExists =
          fs.existsSync(backendPathWithoutExt + '.ts') ||
          fs.existsSync(backendPathWithoutExt + '.js')

        if (!backendExists) {
          return
        }

        // Find the local name(s) of createGraphQLHandler imported from
        // '@cedarjs/graphql-server'
        const importNames = new Set<string>()
        programPath.traverse({
          ImportDeclaration(p) {
            if (
              t.isStringLiteral(p.node.source, {
                value: '@cedarjs/graphql-server',
              })
            ) {
              for (const specifier of p.node.specifiers) {
                if (
                  t.isImportSpecifier(specifier) &&
                  t.isIdentifier(specifier.imported) &&
                  specifier.imported.name === 'createGraphQLHandler'
                ) {
                  importNames.add(specifier.local.name)
                }
              }
            }
          },
        })

        if (importNames.size === 0) {
          return
        }

        // Find the createGraphQLHandler call expression
        const callExpressionPaths: NodePath<types.CallExpression>[] = []
        programPath.traverse({
          CallExpression(p) {
            if (
              t.isIdentifier(p.node.callee) &&
              importNames.has(p.node.callee.name)
            ) {
              callExpressionPaths.push(p)
            }
          },
        })

        if (callExpressionPaths.length === 0) {
          return
        }

        const callExpressionPath = callExpressionPaths[0]
        const statementParent = callExpressionPath.getStatementParent()
        if (!statementParent) {
          return
        }

        // Compute the relative path from graphql.ts to the backend file
        const filename = state.file.opts.filename
        if (!filename) {
          return
        }

        // Use explicit .ts extension: Cedar targets Node.js 24, which strips
        // TypeScript types natively (unflagged since v24.0). The API build uses
        // esbuild with bundle:false so this import stays as a runtime reference
        // resolved directly by Node.js against the file system. All TypeScript
        // constructs in backend.ts (interface declarations, type annotations)
        // are erasable and fully supported by Node.js type stripping.
        const relPath =
          nodePath
            .relative(nodePath.dirname(filename), backendPathWithoutExt)
            .replace(/\\/g, '/') + '.ts'

        // Build the two import declarations to inject
        const importSdl = t.importDeclaration(
          [t.importNamespaceSpecifier(t.identifier('__gqlorm_sdl__'))],
          t.stringLiteral(relPath),
        )

        const importDb = t.importDeclaration(
          [
            t.importSpecifier(
              t.identifier('__gqlorm_db__'),
              t.identifier('db'),
            ),
          ],
          t.stringLiteral('src/lib/db'),
        )

        // Insert both imports at the top of the file (before all other nodes)
        programPath.unshiftContainer('body', [importDb, importSdl])

        // Build the sdls mutation statement:
        //   sdls = { ...sdls, __gqlorm__: { schema: ..., resolvers: ... } }
        const sdlsMutation = t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.identifier('sdls'),
            t.objectExpression([
              t.spreadElement(t.identifier('sdls')),
              t.objectProperty(
                t.identifier('__gqlorm__'),
                t.objectExpression([
                  t.objectProperty(
                    t.identifier('schema'),
                    t.memberExpression(
                      t.identifier('__gqlorm_sdl__'),
                      t.identifier('schema'),
                    ),
                  ),
                  t.objectProperty(
                    t.identifier('resolvers'),
                    t.callExpression(
                      t.memberExpression(
                        t.identifier('__gqlorm_sdl__'),
                        t.identifier('createGqlormResolvers'),
                      ),
                      [t.identifier('__gqlorm_db__')],
                    ),
                  ),
                ]),
              ),
            ]),
          ),
        )

        // Insert the mutation immediately before the createGraphQLHandler
        // statement
        statementParent.insertBefore(sdlsMutation)
      },
    },
  }
}
