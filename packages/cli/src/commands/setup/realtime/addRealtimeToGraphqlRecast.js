import { parse as babelParse } from '@babel/parser'
import recast from 'recast'

/**
 * Attempts to add realtime support to the source code of the GraphQL handler.
 *
 * - Adds `import { realtime } from 'src/lib/realtime'` (or merges into an
 *   existing import)
 * - Ensures the `realtime` property is present in the configuration passed to
 *   `createGraphQLHandler(...)` (supports direct object, config identifiers,
 *   config functions, and conditional expressions where branches are
 *   resolvable).
 *
 * Returns an object:
 *   { code: string, modified: boolean, skipped?: boolean, reason?: string }
 *
 * The function is intentionally conservative: if it cannot confidently parse or
 * resolve the config to an object expression it will not modify the input
 * source.
 *
 * @param {string} sourceCode
 * @returns {{code: string, modified: boolean, skipped?: boolean, reason?: string}}
 */
export function addRealtimeToGraphqlHandler(sourceCode) {
  if (typeof sourceCode !== 'string') {
    throw new TypeError('sourceCode must be a string')
  }

  const parser = {
    parse: (source) =>
      babelParse(source, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }),
  }

  let ast
  try {
    ast = recast.parse(sourceCode, { parser })
  } catch (e) {
    return {
      code: sourceCode,
      modified: false,
      skipped: true,
      reason: 'parse-error',
    }
  }

  const b = recast.types.builders

  // Gather top-level declarations and imports so we can resolve identifiers
  const declared = new Map()
  const topLevelNames = new Set()
  let lastImportIndex = -1
  let firstSrcLibImportIndex = -1
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

      if (node.source && node.source.value === '@cedarjs/graphql-server') {
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

      if (
        node.source &&
        node.source.value &&
        typeof node.source.value === 'string' &&
        node.source.value.startsWith('src/lib/')
      ) {
        if (firstSrcLibImportIndex === -1) {
          firstSrcLibImportIndex = i
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
    return {
      code: sourceCode,
      modified: false,
      skipped: true,
      reason: 'no-createGraphQLHandler-import',
    }
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
    // Add a unique marker as a trailing block comment on the inserted property.
    // This allows us to perform a targeted post-print cleanup (only where we
    // actually inserted the property) and avoids touching occurrences of the
    // identifier appearing in comments or elsewhere in the file.
    prop.trailingComments = [
      {
        type: 'CommentBlock',
        value: '__CEDAR_REALTIME_INSERTED__',
      },
    ]
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
    return { code: sourceCode, modified: false }
  }

  // Ensure we have `import { realtime } from 'src/lib/realtime'` (merge into an
  // existing import or insert a new one)
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

      let insertAt = Math.max(0, lastImportIndex + 1)
      if (firstSrcLibImportIndex !== -1) {
        // Insert into the src/lib imports in alphabetical order (by source.value)
        let libInsertAt = firstSrcLibImportIndex
        for (let j = firstSrcLibImportIndex; j <= lastImportIndex; j += 1) {
          const candidate = programBody[j]
          if (!candidate || candidate.type !== 'ImportDeclaration') {
            break
          }

          const srcVal =
            candidate.source &&
            candidate.source.value &&
            typeof candidate.source.value === 'string'
              ? candidate.source.value
              : null

          if (!srcVal || !srcVal.startsWith('src/lib/')) {
            break
          }

          // If the candidate's module path is alphabetically greater than the realtime import,
          // we should insert before it.
          if (srcVal.localeCompare('src/lib/realtime') > 0) {
            libInsertAt = j
            break
          }

          // Otherwise, place after this candidate and continue
          libInsertAt = j + 1
        }
        insertAt = Math.max(0, libInsertAt)
      }
      programBody.splice(insertAt, 0, importDecl)
    }
  }

  const output = recast.print(ast).code
  let finalOutput = output

  // Remove any empty line between consecutive src/lib imports (so inserted
  // `src/lib/realtime` is grouped directly with other `src/lib/*` imports).
  if (changed && typeof finalOutput === 'string' && finalOutput.length > 0) {
    finalOutput = finalOutput.replace(
      /(import[^\r\n]*from\s+['"]src\/lib\/[^'"]+[^\r\n]*\r?\n)\r?\n(?=import[^\r\n]*from\s+['"]src\/lib\/)/g,
      '$1',
    )
    // Remove any empty line after a newly-inserted realtime property so object
    // properties remain grouped without extra blank lines.
    {
      // Collapse multiple blank lines immediately after our inserted property
      // marker (if any) and then remove the marker itself so it does not appear
      // in the final output. This targets only call sites we modified (because
      // the marker is only added to inserted properties), avoiding accidental
      // matches in comments or unrelated code.
      finalOutput = finalOutput.replace(
        /\/\*__CEDAR_REALTIME_INSERTED__\*\/\r?\n\r?\n/g,
        '/*__CEDAR_REALTIME_INSERTED__*/\n',
      )
      finalOutput = finalOutput.replace(
        /\/\*__CEDAR_REALTIME_INSERTED__\*\//g,
        '',
      )
    }
  }

  if (finalOutput && finalOutput !== sourceCode) {
    return { code: finalOutput, modified: true }
  }

  return { code: sourceCode, modified: false }
}

export default addRealtimeToGraphqlHandler
