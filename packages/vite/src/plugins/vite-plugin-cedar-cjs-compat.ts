import path from 'node:path'

import { parse } from 'acorn'
import type { Plugin } from 'vite'

// UMD heuristics borrowed from @chialab/cjs-to-esm — matches patterns like
// `typeof module.exports === 'object'` and `typeof define === 'function'`.
const UMD_REGEXES = [
  /\btypeof\s+(module\.exports|module|exports)\s*===?\s*['"]object['"]/,
  /['"]object['"]\s*===?\s*typeof\s+(module\.exports|module|exports)/,
  /\btypeof\s+define\s*===?\s*['"]function['"]/,
  /['"]function['"]\s*===?\s*typeof\s+define/,
]

/**
 * Minimal AST node type used during manual traversal. Every property is
 * typed as `unknown` so we are forced to validate before use.
 */
interface AstNode {
  type: string
  [key: string]: unknown
}

/**
 * Type guard that checks whether a value is an AST node (i.e. an object
 * with a `type` string property).
 */
function isAstNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && 'type' in value
}

/**
 * Type guard that checks whether an object has a specific property key.
 */
function hasProperty<K extends string>(
  obj: object,
  key: K,
): obj is Record<K, unknown> {
  return key in obj
}

/**
 * Walk an acorn AST and call the visitor for every node. The visitor may
 * return `false` to skip descending into that node's children.
 */
function walkAst(node: unknown, visitor: (node: AstNode) => false | void) {
  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, visitor)
    }
    return
  }

  if (!isAstNode(node)) {
    return
  }

  const shouldDescend = visitor(node)
  if (shouldDescend === false) {
    return
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'range') {
      continue
    }
    const child = node[key]
    if (child && typeof child === 'object') {
      walkAst(child, visitor)
    }
  }
}

/**
 * Extract the name of an Identifier node, or return `null`.
 */
function getIdentifierName(node: unknown): string | null {
  if (!isAstNode(node)) {
    return null
  }
  return node.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : null
}

/**
 * Check whether a node represents `module.exports`.
 */
function isModuleExports(node: unknown): boolean {
  if (!isAstNode(node)) {
    return false
  }
  return (
    node.type === 'MemberExpression' &&
    getIdentifierName(node.object) === 'module' &&
    getIdentifierName(node.property) === 'exports'
  )
}

/**
 * Check whether a node represents a re-export:
 * `module.exports = require(...)`.
 */
function isReExport(node: unknown): boolean {
  if (!isAstNode(node) || node.type !== 'AssignmentExpression') {
    return false
  }

  return (
    isModuleExports(node.left) &&
    isAstNode(node.right) &&
    node.right.type === 'CallExpression' &&
    getIdentifierName(node.right.callee) === 'require'
  )
}

/**
 * Check whether a node represents `Object.defineProperty(exports, key, { get: … })`
 * or a setter descriptor. Plain value descriptors (e.g. `__esModule` markers)
 * are allowed because they are harmless and are handled correctly by the
 * generated wrapper at runtime.
 *
 * If the descriptor is not a statically analyzable object literal we return
 * `false` — a false negative is safer than breaking on harmless code.
 */
function isObjectDefinePropertyWithGetterOnExports(node: unknown): boolean {
  if (!isAstNode(node) || node.type !== 'CallExpression') {
    return false
  }

  if (!isObjectDefineProperty(node)) {
    return false
  }

  const args = node.arguments
  if (
    !Array.isArray(args) ||
    args.length < 3 ||
    getIdentifierName(args[0]) !== 'exports'
  ) {
    return false
  }

  const descriptor = args[2]
  if (!isAstNode(descriptor) || descriptor.type !== 'ObjectExpression') {
    return false
  }

  const props = descriptor.properties
  if (!Array.isArray(props)) {
    return false
  }

  return props.some((prop) => {
    if (!isAstNode(prop) || prop.type !== 'Property') {
      return false
    }
    const name = getIdentifierName(prop.key)
    return name === 'get' || name === 'set'
  })
}

/**
 * Check whether a node represents `module.exports = { ... }` (an object
 * literal assignment). If it does, returns the ObjectExpression node so
 * the caller can extract named exports from it.
 */
function getModuleExportsObjectLiteral(node: unknown): AstNode | null {
  if (!isAstNode(node) || node.type !== 'AssignmentExpression') {
    return null
  }

  if (
    isModuleExports(node.left) &&
    isAstNode(node.right) &&
    node.right.type === 'ObjectExpression'
  ) {
    return node.right
  }

  return null
}

/**
 * Check whether a node represents `Object.defineProperty(...)`.
 */
function isObjectDefineProperty(node: unknown): boolean {
  if (!isAstNode(node) || node.type !== 'CallExpression') {
    return false
  }

  const callee = node.callee
  if (!isAstNode(callee) || callee.type !== 'MemberExpression') {
    return false
  }

  return (
    getIdentifierName(callee.object) === 'Object' &&
    getIdentifierName(callee.property) === 'defineProperty'
  )
}

/**
 * Build a location string from an acorn node for error messages.
 */
function formatLoc(node: AstNode): string {
  const loc = node.loc
  if (typeof loc !== 'object' || loc === null || !hasProperty(loc, 'start')) {
    return 'unknown location'
  }

  const start = loc.start
  if (
    typeof start !== 'object' ||
    start === null ||
    !hasProperty(start, 'line') ||
    !hasProperty(start, 'column')
  ) {
    return 'unknown location'
  }

  const line = start.line
  const column = start.column
  if (typeof line !== 'number' || typeof column !== 'number') {
    return 'unknown location'
  }

  return `line ${line}, column ${column}`
}

/**
 * A Vite plugin that transforms CommonJS files to ESM so they work with
 * Vite 6's RunnableDevEnvironment / ESModulesEvaluator, which doesn't
 * understand `module.exports` syntax.
 *
 * Uses `cjs-module-lexer` (a Vite transitive dependency) to detect named
 * exports so they are individually re-exported and accessible without going
 * through `.default`.
 *
 * Known limitations (documented inline where relevant):
 *  - No source-map support (`map: null`).
 *  - Object.defineProperty(exports, key, { get: () => ... }) with getter or
 *    setter descriptors are evaluated eagerly at module-load time rather than
 *    lazily; plain value descriptors (e.g. __esModule) are allowed.
 *  - Properties added to a function/class after `module.exports = fn` are
 *    not re-exported.
 *  - Circular dependencies rely on Node's native behaviour via
 *    `createRequire` and are not handled as robustly as Rollup's synthetic
 *    namespace objects.
 */
export function cedarCjsCompatPlugin(): Plugin {
  let lexerInitialized = false

  return {
    name: 'cedar-cjs-compat',
    enforce: 'pre',
    async transform(code, id) {
      // Only handle plain .js / .cjs files — TypeScript and JSX are already
      // transformed by Vite's esbuild plugin and will be valid ESM.
      if (!/\.[cm]?js$/.test(id)) {
        return null
      }

      // Fast bail-out: if there's no CJS-looking syntax, skip parsing.
      if (!/\bmodule\.exports\b|\bexports\.[a-zA-Z_$]/.test(code)) {
        return null
      }

      // Detect UMD wrappers via regex before parsing — these are rare and
      // the regex is sufficient for the common patterns.
      const isUmd = UMD_REGEXES.some((re) => re.test(code))
      if (isUmd) {
        throw new Error(
          `CedarJS CJS compat plugin does not support UMD modules. ` +
            `File: ${id}\n` +
            `If you need to load this file in a Vite RunnableDevEnvironment, ` +
            `consider converting it to pure ESM or using a pre-bundled ESM ` +
            `build from the package author.`,
        )
      }

      let ast: ReturnType<typeof parse>
      try {
        ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
      } catch {
        // If acorn can't parse it, it's probably not plain JS (or it's
        // malformed). Skip and let Vite handle it.
        return null
      }

      /**
       * Scan the AST for unsupported CJS patterns and return the
       * `module.exports = { ... }` ObjectExpression node if found.
       */
      function scanForUnsupportedPatterns(astBody: unknown): AstNode | null {
        let objectLiteral: AstNode | null = null

        walkAst(astBody, (node) => {
          // Stop descending into nested functions — we only care about top-level
          // module-scoped statements.
          if (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression'
          ) {
            return false
          }

          if (node.type !== 'ExpressionStatement') {
            return undefined
          }

          const expr = node.expression
          if (!isAstNode(expr)) {
            return undefined
          }

          // 1) Re-export detection: module.exports = require(...)
          if (isReExport(expr)) {
            throw new Error(
              `CedarJS CJS compat plugin does not support re-exports ` +
                `(module.exports = require(...)). File: ${id}\n` +
                `Named exports from the re-exported module would be lost. ` +
                `Convert the file to explicit named exports, or import the ` +
                `target module directly in the consumer.`,
            )
          }

          // 2) Object.defineProperty(exports, key, { get: () => ... }) —
          // getter/setter descriptors are evaluated eagerly. Plain value
          // descriptors (e.g. __esModule markers) are allowed.
          if (isObjectDefinePropertyWithGetterOnExports(expr)) {
            throw new Error(
              `CedarJS CJS compat plugin does not support Object.defineProperty ` +
                `with getter/setter descriptors on exports because they would ` +
                `be evaluated eagerly at load time rather than lazily. ` +
                `File: ${id}\n` +
                `Convert the file to plain property assignments ` +
                `(exports.foo = ...) or use an ESM build of the package.`,
            )
          }

          // 3) module.exports = { ... } object literal
          const objectLiteralExpr = getModuleExportsObjectLiteral(expr)
          if (objectLiteralExpr) {
            objectLiteral = objectLiteralExpr
            // Don't descend into the object literal — we already have it.
            return false
          }

          return undefined
        })

        return objectLiteral
      }

      const objectLiteralAssignment = scanForUnsupportedPatterns(ast)

      // 4) Local `exports` shadowing — scan top-level declarations.
      walkAst(ast, (node) => {
        if (
          node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression'
        ) {
          return false
        }

        if (node.type !== 'VariableDeclaration') {
          return undefined
        }

        const declarations = node.declarations
        if (!Array.isArray(declarations)) {
          return undefined
        }

        for (const decl of declarations) {
          if (!isAstNode(decl)) {
            continue
          }

          const declId = decl.id
          if (!isAstNode(declId)) {
            continue
          }

          if (
            declId.type === 'Identifier' &&
            typeof declId.name === 'string' &&
            declId.name === 'exports'
          ) {
            throw new Error(
              `CedarJS CJS compat plugin does not support local variables ` +
                `named 'exports' because they shadow the injected CJS ` +
                `globals. File: ${id}\n` +
                `Rename the local variable to something else.`,
            )
          }

          if (declId.type === 'ObjectPattern') {
            const props = declId.properties
            if (Array.isArray(props)) {
              for (const prop of props) {
                if (
                  isAstNode(prop) &&
                  prop.type === 'Property' &&
                  getIdentifierName(prop.value) === 'exports'
                ) {
                  throw new Error(
                    `CedarJS CJS compat plugin does not support destructuring ` +
                      `into a local variable named 'exports' because it shadows ` +
                      `the injected CJS globals. File: ${id}\n` +
                      `Rename the local variable to something else.`,
                  )
                }
              }
            }
          }
        }

        return undefined
      })

      // Use cjs-module-lexer to statically extract named exports from
      // `exports.foo = ...` and `Object.defineProperty(exports, 'foo', ...)`.
      let namedExports: string[] = []
      try {
        if (!lexerInitialized) {
          const { init } = await import('cjs-module-lexer')
          await init()
          lexerInitialized = true
        }
        const { parse: parseLexer } = await import('cjs-module-lexer')
        const { exports } = parseLexer(code)
        namedExports = exports.filter(
          (e) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(e) && e !== 'default',
        )
      } catch {
        // If the lexer fails, fall back to default-only export
      }

      // Fallback: extract named exports from `module.exports = { ... }`.
      if (namedExports.length === 0 && objectLiteralAssignment) {
        const props = objectLiteralAssignment.properties
        if (Array.isArray(props)) {
          for (const prop of props) {
            if (!isAstNode(prop)) {
              continue
            }

            if (prop.type === 'SpreadElement') {
              throw new Error(
                `CedarJS CJS compat plugin encountered an unsupported ` +
                  `pattern in module.exports = { ... } at ` +
                  `${formatLoc(prop)} (spread element (...)). File: ${id}\n` +
                  `Convert the object literal to plain property assignments ` +
                  `(exports.foo = ...) so that cjs-module-lexer can detect ` +
                  `the named exports, or use an ESM build of the package.`,
              )
            }

            if (prop.computed) {
              throw new Error(
                `CedarJS CJS compat plugin encountered an unsupported ` +
                  `pattern in module.exports = { ... } at ` +
                  `${formatLoc(prop)} (computed property key ([expr])). ` +
                  `File: ${id}\n` +
                  `Convert the object literal to plain property assignments ` +
                  `(exports.foo = ...) so that cjs-module-lexer can detect ` +
                  `the named exports, or use an ESM build of the package.`,
              )
            }

            if (prop.method) {
              throw new Error(
                `CedarJS CJS compat plugin encountered an unsupported ` +
                  `pattern in module.exports = { ... } at ` +
                  `${formatLoc(prop)} (method shorthand). File: ${id}\n` +
                  `Convert the object literal to plain property assignments ` +
                  `(exports.foo = ...) so that cjs-module-lexer can detect ` +
                  `the named exports, or use an ESM build of the package.`,
              )
            }

            if (prop.shorthand) {
              throw new Error(
                `CedarJS CJS compat plugin encountered an unsupported ` +
                  `pattern in module.exports = { ... } at ` +
                  `${formatLoc(prop)} (shorthand property). File: ${id}\n` +
                  `Convert the object literal to plain property assignments ` +
                  `(exports.foo = ...) so that cjs-module-lexer can detect ` +
                  `the named exports, or use an ESM build of the package.`,
              )
            }

            const keyName = getIdentifierName(prop.key)
            if (keyName && keyName !== 'default') {
              namedExports.push(keyName)
            }
          }
        }
      }

      const dirPath = JSON.stringify(path.dirname(id))
      const filePath = JSON.stringify(id)

      const hasEsModuleFlag = namedExports.includes('__esModule')
      const safeNamedExports = namedExports.filter(
        (e) => e !== '__esModule' && e !== 'default',
      )

      const namedExportLines = safeNamedExports
        .map(
          (name) =>
            `export const ${name} = __cjs_result__[${JSON.stringify(name)}]`,
        )
        .join('\n')

      // If the module sets __esModule (typical of transpiled ESM→CJS),
      // unwrap the .default so that `import foo from './file'` returns the
      // actual default export rather than the wrapper object.
      const defaultExportLine = hasEsModuleFlag
        ? `export default (__cjs_result__ != null && typeof __cjs_result__ === 'object' && 'default' in __cjs_result__ ? __cjs_result__.default : __cjs_result__)`
        : `export default __cjs_result__`

      return {
        code: `
          import { createRequire as __createRequire__ } from 'node:module'
          const require = __createRequire__(${filePath})
          const module = { exports: {} }
          const exports = module.exports
          const __dirname = ${dirPath}
          const __filename = ${filePath}
          ;(function() {
          ${code}
          }).call(module.exports)
          const __cjs_result__ = module.exports
          ${defaultExportLine}
          ${namedExportLines}
        `,
        // Source maps are not generated. If you hit a break-point issue inside
        // a CJS file loaded through this plugin, the line numbers will be off
        // by the number of lines in the wrapper preamble (~10).
        map: null,
      }
    },
  }
}
