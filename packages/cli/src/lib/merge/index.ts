import type { ParseResult } from '@babel/core'
import { parse, traverse } from '@babel/core'
import { generate } from '@babel/generator'
import type { NodePath } from '@babel/traverse'
import { VISITOR_KEYS } from '@babel/types'
import type { Node } from '@babel/types'
import forEachRight from 'lodash/forEachRight.js'
import partition from 'lodash/partition.js'
import prettier from 'prettier'

import { forEachFunctionOn, nodeIs } from './algorithms.js'
import { semanticIdentity } from './semanticIdentity.js'
import type { MergeProxy } from './strategy.js'
import { isOpaque } from './strategy.js'

type Strategy = Record<string, unknown>
type IdentityFn = (path: NodePath) => string
// A NodeReducer-compatible function signature: matches the type expected by
// isOpaque() from strategy.js. Defined locally to avoid importing the private
// type from that module.
type ReducerFn = (base: MergeProxy, ext: MergeProxy) => void

// TraverseOptions type inferred from the traverse function's second parameter.
// Avoids importing from @babel/traverse directly.
type BabelTraverseOptions = Parameters<typeof traverse>[1]

function extractProperty(property: string, fromObject: Strategy): unknown {
  const tmp = fromObject[property]
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete fromObject[property]
  return tmp
}

// This feels like a weird way to achieve something so simple in Babel, but I can't find a better
// alternative.
function getProgramPath(ast: ParseResult): NodePath {
  let programPath: NodePath | undefined
  traverse(ast, {
    Program(path) {
      programPath = path as unknown as NodePath
      return
    },
  })
  if (programPath === undefined) {
    throw new Error('Unable to find Program node in AST')
  }
  return programPath
}

// See https://github.com/babel/babel/issues/14480
function skipChildren(path: NodePath) {
  for (const key of VISITOR_KEYS[path.type as keyof typeof VISITOR_KEYS] ?? []) {
    path.skipKey(key)
  }
}

/**
 * We can make merge strategies more terse and intuitive if we pass a Babel Node, rather than a
 * NodePath, to the reducer. This would allow us to write:
 *
 * ArrayExpression: (lhs, rhs) => { lhs.elements.push(...rhs.elements) }
 * instead of
 * ArrayExpression: (lhs, rhs) => { lhs.node.elements.push(...rhs.node.elements) }
 *
 * It may seem like a small difference, but the code is much more intuitive if you don't have to
 * think about Babel nodes vs paths when writing reducers.
 *
 * We could just pass the node directly to the reducer, but there are reasonable (though rare) cases
 * where you do want access to the NodePath. To solve this, we create a proxy object that appears as
 * a Babel Node with an additional `path` property that points back to the NodePath.
 */
function makeProxy(path: NodePath): MergeProxy {
  return new Proxy(path, {
    get(target, property) {
      if (property === 'path') {
        return target
      } else {
        // Babel AST nodes have a dynamic shape — property access is inherently
        // untyped here. Double-cast via unknown is required at this Babel
        // internals boundary since NodePath is not indexable by symbol/string.
        return (target.node as unknown as Record<string | symbol, unknown>)[
          property
        ]
      }
    },
    set(target, property, value) {
      if (property === 'path') {
        throw new Error("You can't set a path on a proxy!")
      } else {
        // Same dynamic node access as the getter above.
        ;(target.node as unknown as Record<string | symbol, unknown>)[
          property
        ] = value
        return true
      }
    },
    has(target, property) {
      return property in (target.node as unknown as Record<string | symbol, unknown>)
    },
  }) as unknown as MergeProxy
}

function expressionUses(exp: NodePath, ...ids: string[]): boolean {
  let result = false
  exp.traverse({
    Identifier(path) {
      if (
        !path.parentPath?.isNodeType('VariableDeclarator') &&
        ids.includes(path.node.name)
      ) {
        result = true
        return
      }
    },
  })
  return result
}

// Insert the given expression before the first usage of its name in 'path', or at the end of the
// program body if no such usage exists.
function insertBeforeFirstUsage(expression: NodePath, program: NodePath) {
  // program.get('body') returns top-level statement paths. The NodePath.get
  // return type is a broad union for generic NodePaths — cast as unknown first
  // since we know the Program body is always NodePath[].
  const body = program.get('body') as unknown as NodePath[]
  // expression.getBindingIdentifiers() returns a map of binding name → Node.
  // Cast via unknown because NodePath's generic type is not specific enough
  // to expose this method statically.
  const bindingIds = Object.keys(
    (expression as unknown as { getBindingIdentifiers(): Record<string, Node> }).getBindingIdentifiers(),
  )
  const pos = body.findIndex((exp) => expressionUses(exp, ...bindingIds))
  if (pos !== -1) {
    return (body[pos] as unknown as { insertBefore(node: Node): NodePath[] }).insertBefore(
      expression.node,
    )
  } else {
    // pushContainer's key param is typed as 'never' for generic NodePaths.
    // Cast via unknown: we know this is a Program node whose 'body' is valid.
    return (program as unknown as { pushContainer(key: string, node: Node): NodePath[] }).pushContainer(
      'body',
      expression.node,
    )
  }
}

function insertAfterLastImport(expression: NodePath, program: NodePath) {
  const body = program.get('body') as unknown as NodePath[]
  let lastImportIdx = -1
  for (let i = 0; i < body.length; i++) {
    if (body[i].isNodeType('ImportDeclaration')) {
      lastImportIdx = i
    }
  }
  return (body[lastImportIdx] as unknown as { insertAfter(node: Node): NodePath[] }).insertAfter(
    expression.node,
  )
}

function prune(path: NodePath) {
  switch (path.parentPath?.type) {
    // If pruning 'path' would yield an ill-formed parent (e.g, '{foo:}' or 'const x;'), prune it.
    case 'ObjectProperty':
    case 'VariableDeclarator':
      return path.parentPath.remove()
    default:
      console.log(
        `Warning: default prune strategy for ${path.parentPath?.type}`,
      )
    // eslint-disable-next-line no-fallthrough
    case 'Program':
    case 'ArrayExpression':
      return path.remove()
  }
}

// When merging, trailing comments are a bit nasty. A comment can be parsed as a leading comment
// of one expression, and a trailing comment of a subsequent expression. This is sort of an open
// issue for Babel: https://github.com/babel/babel/issues/7002, but we can work around it pretty
// easily with the following:
function stripTrailingCommentsStrategy() {
  return {
    enter(path: NodePath) {
      // trailingComments is a non-standard Babel extension on nodes — not in the
      // @babel/types typings but present at runtime.
      ;(path.node as unknown as { trailingComments: unknown[] }).trailingComments =
        []
    },
  }
}

/**
 * The node types specified in the strategy are copied from extAST into baseAST.
 *
 * @param { import("@babel/core").ParseResult } baseAST
 * @param { import("@babel/core").ParseResult } extAST
 * @param { Object } strategy
 *
 * 1. Traverse extAST and track the semantic IDs of all of the nodes for which we have a merge
 *    strategy.
 * 2. Traverse baseAST. On node exit, attempt to merge semantically-equivalent ext nodes.
 *     a. When a semantically equivalent ext node is merged, it is pruned from ext.
 * 3. Traverse extAST's body (if any nodes remain) and attempt to put top-level declarations at
 *    their latest-possible positions.
 *     a. Latest-possible is defined as the position immediately preceeding the first use of the
 *     node's binding, if it exists.
 */
function mergeAST(baseAST: ParseResult, extAST: ParseResult, strategy: Strategy = {}) {
  const identity =
    (extractProperty('identity', strategy) as IdentityFn | undefined) ??
    semanticIdentity
  const identities: Record<string, NodePath[]> = {}
  const baseVisitor: Strategy = { ...stripTrailingCommentsStrategy() }
  const extVisitor: Strategy = { ...stripTrailingCommentsStrategy() }

  forEachFunctionOn(strategy, (typename: string, strat: (...args: unknown[]) => unknown) => {
    extVisitor[typename] = {
      enter(path: NodePath) {
        const id = identity(path)
        if (id) {
          ;(identities[id] ||= []).push(path)
        }
      },
    }
    baseVisitor[typename] = {
      enter(path: NodePath) {
        // isOpaque expects a NodeReducer | OpaqueReducer. strat is AnyFn from
        // forEachFunctionOn; we know strategy values are reducers at runtime.
        if (isOpaque(strat as unknown as ReducerFn)) {
          skipChildren(path)
        }
      },
      exit(path: NodePath) {
        const exts = extractProperty(identity(path), identities) as
          | NodePath[]
          | undefined
        if (exts) {
          const proxyPath = makeProxy(path)
          exts.map(makeProxy).forEach((ext) => {
            // strat is a reducer function (NodeReducer) guaranteed by
            // forEachFunctionOn — values that are not functions are skipped.
            ;(strat as unknown as ReducerFn)(proxyPath, ext)
            prune(ext.path)
          })
        }
      },
    }
  })

  // The visitor objects are built dynamically from strategy keys (valid Babel
  // node type names). BabelTraverseOptions is inferred from traverse's param
  // type. Casting via unknown because our Record<string, unknown> visitor
  // cannot be checked structurally against the complex TraverseOptions generic.
  traverse(extAST as unknown as Node, extVisitor as unknown as BabelTraverseOptions)
  traverse(baseAST as unknown as Node, baseVisitor as unknown as BabelTraverseOptions)

  const baseProgram = getProgramPath(baseAST)
  // getProgramPath(extAST).get('body') returns top-level paths (NodePath[]).
  // Cast via unknown: the generic NodePath.get return type is a broad union
  // that cannot be narrowed statically without knowing the concrete node type.
  const body = getProgramPath(extAST).get('body') as unknown as NodePath[]
  const [imports, others] = partition(
    body,
    // nodeIs returns (node: Node) => boolean; here we have NodePaths, so we
    // check path.node to stay type-safe.
    (path: NodePath) => nodeIs('ImportDeclaration')(path.node as Node),
  )

  imports.forEach((exp) => insertAfterLastImport(exp, baseProgram))
  forEachRight(others, (exp: NodePath) =>
    insertBeforeFirstUsage(exp, baseProgram),
  )
}

/**
 * Copy specified AST nodes from extension into base. Use reducer functions specified in strategy to
 * recursively merge from leaf to root.
 * @param {string} base - a string of JavaScript code. Must be well-formed.
 * @param {string} extension - a string of JavaScript code. May refer to bindings only defined in base.
 * @param {Object} strategy - Mapping of AST node name to reducer functions.
 * @returns
 */
export async function merge(
  base: string,
  extension: string,
  strategy: Strategy,
): Promise<string> {
  function parseReact(code: string): ParseResult {
    const result = parse(code, {
      filename: 'merged.tsx', // required to prevent babel error. The .tsx is relevant
      presets: ['@babel/preset-typescript'],
    })
    if (result === null) {
      throw new Error('Failed to parse code')
    }
    return result
  }

  const baseAST = parseReact(base)
  const extAST = parseReact(extension)

  mergeAST(baseAST, extAST, strategy)
  const { code } = generate(baseAST)

  // When testing, use prettier here to produce predictable outputs.
  // Otherwise, leave formatting to the caller.
  return process.env.VITEST_POOL_ID
    ? await prettier.format(code, {
        parser: 'babel-ts',
        bracketSpacing: true,
        tabWidth: 2,
        semi: false,
        singleQuote: true,
      })
    : code
}
