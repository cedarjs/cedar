import { parseSync, Visitor } from 'oxc-parser'
import type { Program } from 'oxc-parser'

/**
 * Injects imports for `gql` and `context` into API source files that reference
 * them without importing them. Uses an oxc-parser AST walk to check bindings,
 * so local declarations never receive a conflicting import.
 *
 * This replaces `babel-plugin-auto-import` for the esbuild API build path,
 * matching the behavior of `cedarAutoImportsPlugin` in Vite builds.
 */

export function applyAutoImports(code: string): string {
  const result = parseSync('temp.ts', code, {
    lang: 'ts',
    sourceType: 'module',
  })

  const needsGql = checkNeeds('gql', result.program, code)
  const needsContext = checkNeeds('context', result.program, code)

  let resultCode = code

  if (needsGql) {
    resultCode = "import gql from 'graphql-tag'\n" + resultCode
  }

  if (needsContext) {
    resultCode = "import { context } from '@cedarjs/context'\n" + resultCode
  }

  return resultCode
}

function checkNeeds(name: string, program: Program, code: string) {
  // Skip if the name isn't even mentioned in the file
  if (!code.includes(name)) {
    return false
  }

  // Track whether we found an import or declaration for this name
  let isBound = false

  // Also track whether we found a usage that's not part of an import
  let hasUsage = false

  // Check import declarations and declarations first
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          if (
            (specifier.imported.type === 'Identifier' &&
              specifier.imported.name === name) ||
            specifier.local.name === name
          ) {
            isBound = true
            break
          }
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          if (specifier.local.name === name) {
            isBound = true
            break
          }
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          if (specifier.local.name === name) {
            isBound = true
            break
          }
        }
      }
    }

    if (
      node.type === 'VariableDeclaration' &&
      node.declarations[0]?.id.type === 'Identifier' &&
      node.declarations[0].id.name === name
    ) {
      isBound = true
    }

    if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
      isBound = true
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      if (node.declaration.type === 'VariableDeclaration') {
        if (
          node.declaration.declarations[0]?.id.type === 'Identifier' &&
          node.declaration.declarations[0].id.name === name
        ) {
          isBound = true
        }
      }
    }
  }

  if (isBound) {
    return false
  }

  // Walk all Identifier nodes to find usages
  new Visitor({
    Identifier(node) {
      // Only flag references that are not already handled by the declaration
      // check above. BindingIdentifier nodes (e.g. function params, variable
      // declarations inside functions) are also matched here, but in practice
      // `gql` and `context` are rarely rebound in API code.
      if (node.name === name) {
        hasUsage = true
      }
    },
  }).visit(program)

  return hasUsage
}
