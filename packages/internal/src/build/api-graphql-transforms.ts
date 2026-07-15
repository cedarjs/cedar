import fs from 'node:fs'
import path from 'node:path'

import { parseSync, Visitor } from 'oxc-parser'
import type { CallExpression } from 'oxc-parser'

import {
  getConfig,
  getPaths,
  importStatementPath,
} from '@cedarjs/project-config'

/**
 * Extracts the options argument from createGraphQLHandler calls and stores
 * them in an exported variable. Returns the transformed code, or null if no
 * transformation was needed.
 *
 * Transforms:
 *   export const handler = createGraphQLHandler({ options })
 * into:
 *   export const __cedar_graphqlOptions = { options }
 *   export const handler = createGraphQLHandler(__cedar_graphqlOptions)
 */
export function applyGraphqlOptionsExtract(code: string): string | null {
  // Check if already transformed
  if (code.includes('__cedar_graphqlOptions')) {
    return null
  }

  const { program } = parseSync('graphql.ts', code, {
    // lang is only a parse hint; 'ts' also parses JS (the graphql handler can
    // be graphql.js in JS projects), so this is safe for both file types.
    lang: 'ts',
    sourceType: 'module',
  })

  // Find all imported local names for createGraphQLHandler
  const importNames = new Set<string>()
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      if (node.source.value !== '@cedarjs/graphql-server') {
        continue
      }
      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name === 'createGraphQLHandler'
        ) {
          importNames.add(specifier.local.name)
        }
      }
    }
  }

  if (importNames.size === 0) {
    return null
  }

  // Find all calls to createGraphQLHandler
  const callExpressionPaths: CallExpression[] = []
  new Visitor({
    CallExpression(node) {
      if (
        node.callee.type === 'Identifier' &&
        importNames.has(node.callee.name)
      ) {
        callExpressionPaths.push(node)
      }
    },
  }).visit(program)

  if (callExpressionPaths.length > 1) {
    return null
  }

  const callExpression = callExpressionPaths[0]
  if (!callExpression) {
    return null
  }

  const options = callExpression.arguments[0]
  if (!options) {
    return null
  }

  if (
    options.type !== 'Identifier' &&
    options.type !== 'ObjectExpression' &&
    options.type !== 'CallExpression' &&
    options.type !== 'ConditionalExpression'
  ) {
    return null
  }

  // Extract the options into a new exported variable. We place it immediately
  // before the call's own statement (the line it appears on, or the statement
  // that contains it), and replace the first argument with the new identifier.
  const optionsStart = options.start
  const optionsEnd = options.end

  // Insert the options constant on its own line immediately before the line
  // that contains the call, preserving the surrounding code and whitespace.
  const lineStart = code.lastIndexOf('\n', callExpression.start) + 1
  const indentMatch = /^[ \t]*/.exec(code.slice(lineStart))
  const indent = indentMatch ? indentMatch[0] : ''
  const optionsConst = `${indent}export const __cedar_graphqlOptions = ${code.slice(
    optionsStart,
    optionsEnd,
  )}\n`

  const before = code.slice(0, lineStart)
  const between = code.slice(lineStart, optionsStart)
  const after = code.slice(optionsEnd)

  return before + optionsConst + between + '__cedar_graphqlOptions' + after
}

/**
 * Injects the auto-generated gqlorm backend into graphql.ts at build time.
 *
 * When `experimental.gqlorm.enabled = true` and `.cedar/gqlorm/backend.ts`
 * exists, this function:
 *
 * 1. Adds imports at the top of graphql.ts:
 *      import * as __gqlorm_sdl__ from '../../../.cedar/gqlorm/backend'
 *      import { db as __gqlorm_db__ } from 'src/lib/db'
 *
 * 2. Inserts a statement immediately before the `createGraphQLHandler` call:
 *      Object.assign(sdls, {
 *        __gqlorm__: {
 *          schema: __gqlorm_sdl__.schema,
 *          resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
 *        },
 *      })
 *
 * Returns the transformed code, or null if no transformation was needed.
 */
export function applyGqlormInject(
  code: string,
  id: string,
  dbExt: '.ts' | '.js' = '.ts',
): string | null {
  // Check if already transformed to prevent double-application
  if (code.includes('__gqlorm_sdl__')) {
    return null
  }

  // Quick check for createGraphQLHandler
  if (!code.includes('createGraphQLHandler')) {
    return null
  }

  // Check if gqlorm is enabled
  if (!getConfig().experimental?.gqlorm?.enabled) {
    return null
  }

  const backendPathWithoutExt = path.join(
    getPaths().generated.base,
    'gqlorm',
    'backend',
  )

  // The generated gqlorm backend is always backend.ts (never compiled to
  // .js), so we only check for the .ts file. gqlorm is intentionally a
  // TypeScript-only feature; JS projects are out of scope and the injected
  // import below hardcodes the .ts extension on purpose.
  if (!fs.existsSync(backendPathWithoutExt + '.ts')) {
    return null
  }

  // Find the export const handler = createGraphQLHandler pattern
  const handlerPattern =
    /^export\s+const\s+(\w+)\s*=\s*createGraphQLHandler\s*\(/m

  const handlerMatch = handlerPattern.exec(code)
  if (!handlerMatch) {
    return null
  }

  const handlerLineStart = code.lastIndexOf('\n', handlerMatch.index) + 1

  // Compute the relative path from graphql.ts to the backend file.
  // Always use .ts extension: the gqlorm generator produces backend.ts and never
  // compiles it to .js. Cedar targets Node.js 24 which supports TypeScript type
  // stripping natively (unflagged since v24.0), so .ts imports work at runtime
  // regardless of whether the calling file was compiled by esbuild or Vite.
  const relPath =
    importStatementPath(
      path.relative(path.dirname(id), backendPathWithoutExt),
    ) + '.ts'

  // Compute the relative path from graphql.ts to src/lib/db.
  // We cannot use the bare specifier 'src/lib/db' here because this function
  // runs after the Babel module-resolver has already rewritten all `src/` paths
  // to relative paths. A bare `src/lib/db` in the output would not be
  // resolvable by Node.js at runtime.
  // In esbuild context, db.ts is compiled to db.js in dist/, so .js is needed.
  // In Vite context, .ts works because Vite resolves TypeScript natively.
  const dbSrcPath = path.join(getPaths().api.src, 'lib', 'db')
  const relDbPath =
    importStatementPath(path.relative(path.dirname(id), dbSrcPath)) + dbExt

  // Build the imports to inject at the top of the file
  const importDb = `import { db as __gqlorm_db__ } from '${relDbPath}'`
  const importSdl = `import * as __gqlorm_sdl__ from '${relPath}'`
  const importsToAdd = `${importDb}\n${importSdl}\n`

  // Build the Object.assign mutation statement (with proper indentation)
  const sdlsMutation = `Object.assign(sdls, {
    __gqlorm__: {
      schema: __gqlorm_sdl__.schema,
      resolvers: __gqlorm_sdl__.createGqlormResolvers(__gqlorm_db__),
    },
  })\n  `

  // Build the transformed code: prepend imports, then insert mutation before handler
  const transformed =
    importsToAdd +
    code.slice(0, handlerLineStart) +
    sdlsMutation +
    code.slice(handlerLineStart)

  return transformed
}
