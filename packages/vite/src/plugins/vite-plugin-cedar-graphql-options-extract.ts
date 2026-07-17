import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import type { CallExpression } from 'oxc-parser'
import { parseSync, Visitor } from 'oxc-parser'
import type { Plugin } from 'vite'

/**
 * Vite plugin that extracts options passed to createGraphQLHandler into an
 * exported variable.
 *
 * Transforms:
 *   export const handler = createGraphQLHandler({ options })
 * into:
 *   export const __cedar_graphqlOptions = { options }
 *   export const handler = createGraphQLHandler(__cedar_graphqlOptions)
 *
 * This allows options to be imported elsewhere and enables the gqlorm-inject
 * plugin to mutate the sdls object in-place before the call.
 *
 * The extraction uses an oxc-parser AST walk (see `applyGraphqlOptionsExtract`
 * below) so the transform is robust against aliased imports, nested calls, and
 * string escapes. The same logic is duplicated in
 * `@cedarjs/internal` (`applyGraphqlOptionsExtract`) for the standalone esbuild
 * API build
 */
export function cedarGraphqlOptionsExtractPlugin(): Plugin {
  return {
    name: 'cedar-graphql-options-extract',
    transform(code, id) {
      // Only transform the graphql handler file.
      // Check for path separator to avoid matching e.g. notgraphql.ts, and
      // accept both .ts and .js since JS projects scaffold graphql.js.
      if (!id.endsWith('/graphql.ts') && !id.endsWith('/graphql.js')) {
        return null
      }

      // Quick check for createGraphQLHandler
      if (!code.includes('createGraphQLHandler')) {
        return null
      }

      const result = applyGraphqlOptionsExtract(code)
      if (!result) {
        return null
      }

      return {
        code: result.code,
        map: result.map,
      }
    },
  }
}

/**
 * Extracts the options argument from createGraphQLHandler calls and stores
 * them in an exported variable. Returns the transformed code with a sourcemap,
 * or null if no transformation was needed.
 *
 * Transforms:
 *   export const handler = createGraphQLHandler({ options })
 * into:
 *   export const __cedar_graphqlOptions = { options }
 *   export const handler = createGraphQLHandler(__cedar_graphqlOptions)
 *
 * Duplicate of `@cedarjs/internal`'s `applyGraphqlOptionsExtract` so this
 * logic can run inside the Vite plugin pipeline without depending on internal's
 * build output.
 */
export function applyGraphqlOptionsExtract(
  code: string,
): { code: string; map: SourceMap } | null {
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
  // before the call's own line, and replace the first argument with the new
  // identifier reference.
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

  const s = new MagicString(code)
  s.prependLeft(lineStart, optionsConst)
  s.overwrite(optionsStart, optionsEnd, '__cedar_graphqlOptions')

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}
