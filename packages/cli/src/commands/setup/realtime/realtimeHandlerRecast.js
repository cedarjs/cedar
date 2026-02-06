import fs from 'node:fs'
import path from 'node:path'

import { parse as babelParse } from '@babel/parser'
import { Listr } from 'listr2'
import recast from 'recast'

import { addApiPackages } from '@cedarjs/cli-helpers'
import { generate as generateTypes } from '@cedarjs/internal/dist/generate/generate'
import { projectIsEsm } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject, serverFileExists } from '../../../lib/project.js'
import { setupServerFileTasks } from '../server-file/serverFileHandler.js'

const { version } = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../../package.json'),
    'utf-8',
  ),
)

export async function handler({ force, includeExamples, verbose }) {
  const redwoodPaths = getPaths()
  const ts = isTypeScriptProject()

  const realtimeLibFilePath = path.join(
    redwoodPaths.api.lib,
    `realtime.${isTypeScriptProject() ? 'ts' : 'js'}`,
  )

  const tasks = new Listr(
    [
      addApiPackages(['ioredis@^5', `@cedarjs/realtime@${version}`]),
      {
        title: 'Adding the realtime api lib...',
        task: async () => {
          const serverFileTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'realtime.ts.template',
            ),
            'utf-8',
          )

          const setupScriptContent = ts
            ? serverFileTemplateContent
            : await transformTSToJS(
                realtimeLibFilePath,
                serverFileTemplateContent,
              )

          return [
            writeFile(realtimeLibFilePath, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Enabling realtime support in the GraphQL handler...',
        task: async (ctx) => {
          const graphqlHandlerPath = path.join(
            redwoodPaths.api.functions,
            `graphql.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          if (!fs.existsSync(graphqlHandlerPath)) {
            ctx.realtimeHandlerSkipped = true
            return
          }

          const originalSource = fs.readFileSync(graphqlHandlerPath, 'utf-8')

          const parser = {
            parse: (source) =>
              babelParse(source, {
                sourceType: 'module',
                plugins: [
                  'typescript',
                  'jsx',
                  'classProperties',
                  'decorators-legacy',
                  'optionalChaining',
                  'nullishCoalescingOperator',
                  'dynamicImport',
                ],
              }),
          }

          let ast
          try {
            ast = recast.parse(originalSource, { parser })
          } catch (e) {
            // If we cannot parse the file, we should skip making changes conservatively.
            ctx.realtimeHandlerSkipped = true
            return
          }

          const b = recast.types.builders

          // Gather top-level info (imports, declarations) so we can resolve identifiers
          const declared = new Map()
          const topLevelNames = new Set()
          let lastImportIndex = -1
          let createHandlerLocalName = null
          let realtimeImportedLocalName = null
          let realtimeImportDeclNode = null

          const programBody = ast.program.body
          for (let i = 0; i < programBody.length; i += 1) {
            const node = programBody[i]
            if (node.type === 'ImportDeclaration') {
              lastImportIndex = i
              for (const spec of node.specifiers) {
                if (spec && spec.local && spec.local.name) {
                  topLevelNames.add(spec.local.name)
                }
              }

              if (
                node.source &&
                node.source.value === '@cedarjs/graphql-server'
              ) {
                for (const spec of node.specifiers) {
                  if (
                    spec.type === 'ImportSpecifier' &&
                    spec.imported &&
                    spec.imported.name === 'createGraphQLHandler'
                  ) {
                    createHandlerLocalName = spec.local.name
                  }
                }
              }

              if (node.source && node.source.value === 'src/lib/realtime') {
                realtimeImportDeclNode = node
                for (const spec of node.specifiers) {
                  if (
                    spec.type === 'ImportSpecifier' &&
                    spec.imported &&
                    spec.imported.name === 'realtime'
                  ) {
                    realtimeImportedLocalName = spec.local.name
                  }
                }
              }
            } else if (node.type === 'VariableDeclaration') {
              for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier') {
                  declared.set(decl.id.name, decl.init)
                  topLevelNames.add(decl.id.name)
                }
              }
            } else if (node.type === 'FunctionDeclaration') {
              if (node.id && node.id.name) {
                declared.set(node.id.name, node)
                topLevelNames.add(node.id.name)
              }
            }
          }

          if (!createHandlerLocalName) {
            // No recognizable import for createGraphQLHandler; be conservative and skip modifications
            ctx.realtimeHandlerSkipped = true
            return
          }

          function pickUniqueLocalName(preferred) {
            let name = preferred
            if (topLevelNames.has(name)) {
              let idx = 1
              while (topLevelNames.has(name + idx)) {
                idx += 1
              }
              name = name + idx
            }

            topLevelNames.add(name)
            return name
          }

          const realtimeLocalName =
            realtimeImportedLocalName || pickUniqueLocalName('realtime')

          function objectHasRealtime(objNode) {
            if (!objNode || objNode.type !== 'ObjectExpression') {
              return false
            }

            for (const prop of objNode.properties) {
              if (!prop || !prop.key) {
                continue
              }
              const key = prop.key
              if (key.type === 'Identifier' && key.name === 'realtime') {
                return true
              }
              if (
                (key.type === 'Literal' || key.type === 'StringLiteral') &&
                key.value === 'realtime'
              ) {
                return true
              }
            }

            return false
          }

          function makeRealtimeProperty() {
            const prop = b.property(
              'init',
              b.identifier(realtimeLocalName),
              b.identifier(realtimeLocalName),
            )
            prop.shorthand = true
            return prop
          }

          function insertRealtimeIntoObject(objNode) {
            if (!objNode || objNode.type !== 'ObjectExpression') {
              return false
            }

            if (objectHasRealtime(objNode)) {
              return false
            }

            // Try to insert before an `onException` property if present, otherwise append
            let insertIndex = -1
            for (let i = 0; i < objNode.properties.length; i += 1) {
              const prop = objNode.properties[i]
              if (!prop || !prop.key) {
                continue
              }
              const key = prop.key
              if (
                (key.type === 'Identifier' && key.name === 'onException') ||
                ((key.type === 'Literal' || key.type === 'StringLiteral') &&
                  key.value === 'onException')
              ) {
                insertIndex = i
                break
              }
            }

            const realtimeProp = makeRealtimeProperty()

            if (insertIndex !== -1) {
              objNode.properties.splice(insertIndex, 0, realtimeProp)
            } else {
              objNode.properties.push(realtimeProp)
            }

            return true
          }

          // Recursive processing of nodes to find modifiable object expressions
          const visitedFunctions = new Set()
          function processPotentialNode(node) {
            if (!node) {
              return false
            }

            if (visitedFunctions.has(node)) {
              return false
            }

            if (node.type === 'ObjectExpression') {
              return insertRealtimeIntoObject(node)
            }

            if (node.type === 'Identifier') {
              const declInit = declared.get(node.name)
              if (declInit) {
                return processPotentialNode(declInit)
              }
              return false
            }

            if (node.type === 'CallExpression') {
              if (node.callee && node.callee.type === 'Identifier') {
                const fn = declared.get(node.callee.name)
                if (fn) {
                  return processFunctionLikeNode(fn)
                }
              }
              return false
            }

            if (node.type === 'ConditionalExpression') {
              let changed = false
              const changedCons = processPotentialNode(node.consequent)
              if (changedCons) {
                changed = true
              }
              const changedAlt = processPotentialNode(node.alternate)
              if (changedAlt) {
                changed = true
              }
              return changed
            }

            if (
              node.type === 'ArrowFunctionExpression' ||
              node.type === 'FunctionExpression' ||
              node.type === 'FunctionDeclaration'
            ) {
              return processFunctionLikeNode(node)
            }

            return false
          }

          function processFunctionLikeNode(fnNode) {
            if (!fnNode) {
              return false
            }

            if (visitedFunctions.has(fnNode)) {
              return false
            }
            visitedFunctions.add(fnNode)

            if (
              fnNode.type === 'ArrowFunctionExpression' &&
              fnNode.body &&
              fnNode.body.type === 'ObjectExpression'
            ) {
              return insertRealtimeIntoObject(fnNode.body)
            }

            if (fnNode.body && fnNode.body.type === 'BlockStatement') {
              let changed = false
              recast.types.visit(fnNode.body, {
                visitReturnStatement(path) {
                  const ret = path.node
                  if (ret && ret.argument) {
                    const modified = processPotentialNode(ret.argument)
                    if (modified) {
                      changed = true
                    }
                  }
                  this.traverse(path)
                },
              })
              return changed
            }

            if (fnNode.type === 'FunctionDeclaration') {
              return processFunctionLikeNode({
                type: 'FunctionExpression',
                body: fnNode.body,
              })
            }

            return false
          }

          // Walk AST, find calls to the local name for createGraphQLHandler and attempt modification
          let changed = false
          recast.types.visit(ast, {
            visitCallExpression(path) {
              const node = path.node
              if (
                node &&
                node.callee &&
                node.callee.type === 'Identifier' &&
                node.callee.name === createHandlerLocalName
              ) {
                const firstArg = node.arguments && node.arguments[0]
                if (firstArg) {
                  const modified = processPotentialNode(firstArg)
                  if (modified) {
                    changed = true
                  }
                }
              }

              this.traverse(path)
            },
          })

          if (!changed) {
            ctx.realtimeHandlerSkipped = true
            return
          }

          // Ensure the import exists (merge into existing import or insert a new one)
          if (!realtimeImportedLocalName) {
            if (realtimeImportDeclNode) {
              realtimeImportDeclNode.specifiers.push(
                b.importSpecifier(
                  b.identifier('realtime'),
                  b.identifier(realtimeLocalName),
                ),
              )
            } else {
              const importDecl = b.importDeclaration(
                [
                  b.importSpecifier(
                    b.identifier('realtime'),
                    b.identifier(realtimeLocalName),
                  ),
                ],
                b.literal('src/lib/realtime'),
              )

              const insertAt = Math.max(0, lastImportIndex + 1)
              programBody.splice(insertAt, 0, importDecl)
            }
          }

          const output = recast.print(ast).code
          if (output && output !== originalSource) {
            fs.writeFileSync(graphqlHandlerPath, output, 'utf-8')
          }
        },
      },
      {
        title: 'Adding Countdown example subscription...',
        enabled: () => includeExamples,
        task: async () => {
          let exampleSubscriptionTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'countdown',
              `countdown.ts.template`,
            ),
            'utf-8',
          )

          if (projectIsEsm()) {
            exampleSubscriptionTemplateContent =
              exampleSubscriptionTemplateContent.replace(
                "import gql from 'graphql-tag'",
                "import { gql } from 'graphql-tag'",
              )
          }

          const exampleFile = path.join(
            redwoodPaths.api.subscriptions,
            'countdown',
            `countdown.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const setupScriptContent = ts
            ? exampleSubscriptionTemplateContent
            : await transformTSToJS(
                exampleFile,
                exampleSubscriptionTemplateContent,
              )

          return [
            writeFile(exampleFile, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Adding NewMessage example subscription...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              `rooms.sdl.ts.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `rooms.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              `rooms.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'rooms',
            `rooms.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // subscription

          let exampleSubscriptionTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'subscriptions',
              'newMessage',
              'newMessage.ts.template',
            ),
            'utf-8',
          )

          if (projectIsEsm()) {
            exampleSubscriptionTemplateContent =
              exampleSubscriptionTemplateContent.replace(
                "import gql from 'graphql-tag'",
                "import { gql } from 'graphql-tag'",
              )
          }

          const exampleFile = path.join(
            redwoodPaths.api.subscriptions,
            'newMessage',
            `newMessage.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const setupScriptContent = ts
            ? exampleSubscriptionTemplateContent
            : await transformTSToJS(
                exampleFile,
                exampleSubscriptionTemplateContent,
              )

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
            writeFile(exampleFile, setupScriptContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: 'Adding Auctions example live query...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'liveQueries',
              'auctions',
              `auctions.sdl.ts.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `auctions.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'liveQueries',
              'auctions',
              `auctions.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'auctions',
            `auctions.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },

      {
        title: 'Adding Defer example queries...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'defer',
              'fastAndSlowFields',
              `fastAndSlowFields.sdl.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `fastAndSlowFields.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'defer',
              'fastAndSlowFields',
              `fastAndSlowFields.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'fastAndSlowFields',
            `fastAndSlowFields.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },

      {
        title: 'Adding Stream example queries...',
        enabled: () => includeExamples,
        task: async () => {
          // sdl

          const exampleSdlTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'stream',
              'alphabet',
              `alphabet.sdl.template`,
            ),
            'utf-8',
          )

          const sdlFile = path.join(
            redwoodPaths.api.graphql,
            `alphabet.sdl.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const sdlContent = ts
            ? exampleSdlTemplateContent
            : await transformTSToJS(sdlFile, exampleSdlTemplateContent)

          // service

          const exampleServiceTemplateContent = fs.readFileSync(
            path.resolve(
              import.meta.dirname,
              'templates',
              'stream',
              'alphabet',
              `alphabet.ts.template`,
            ),
            'utf-8',
          )
          const serviceFile = path.join(
            redwoodPaths.api.services,
            'alphabet',
            `alphabet.${isTypeScriptProject() ? 'ts' : 'js'}`,
          )

          const serviceContent = ts
            ? exampleServiceTemplateContent
            : await transformTSToJS(serviceFile, exampleServiceTemplateContent)

          // write all files
          return [
            writeFile(sdlFile, sdlContent, {
              overwriteExisting: force,
            }),
            writeFile(serviceFile, serviceContent, {
              overwriteExisting: force,
            }),
          ]
        },
      },
      {
        title: `Generating types...`,
        task: async () => {
          await generateTypes()
          console.log(
            'Note: You may need to manually restart GraphQL in VSCode to see the new types take effect.\n\n',
          )
        },
      },
    ],
    {
      rendererOptions: { collapseSubtasks: false, persistentOutput: true },
      renderer: verbose ? 'verbose' : 'default',
    },
  )

  try {
    if (!serverFileExists()) {
      tasks.add(setupServerFileTasks({ force }))
    }

    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
