import type {
  ArrowFunctionExpression,
  ObjectPattern,
  ParamPattern,
} from '@oxc-project/types'
import { parseSync } from 'oxc-parser'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

/**
 * Vite plugin that wraps exported API functions with OpenTelemetry spans to
 * provide automatic tracing in your Cedar API.
 *
 * For each `export const fn = (async?) (...) => {...}` declaration in an API
 * file this plugin:
 *
 * 1. Adds an import at the top of the file:
 *      import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'
 *
 * 2. Wraps the original export with an OTel span:
 *      export const fn = (async?) (...params) => {
 *        const __fn = (async?) (...params) => { ...original body... }
 *        const RW_OTEL_WRAPPER_TRACER = RW_OTEL_WRAPPER_TRACE.getTracer('redwoodjs')
 *        const RW_OTEL_WRAPPER_RESULT = (await?) RW_OTEL_WRAPPER_TRACER.startActiveSpan(
 *          'redwoodjs:api:<folder>:<fnName>',
 *          (async?) (span) => { ... }
 *        )
 *        return RW_OTEL_WRAPPER_RESULT
 *      }
 *
 * This replaces `babel-plugin-redwood-otel-wrapping` for Vite builds.
 * The Babel plugin is still used for Jest transforms.
 */
export function cedarOtelWrappingPlugin(): Plugin {
  return {
    name: 'cedar-otel-wrapping',

    transform(code, id) {
      let apiSrc: string
      try {
        apiSrc = normalizePath(getPaths().api.src)
      } catch {
        return null
      }

      if (!normalizePath(id).startsWith(apiSrc + '/')) {
        return null
      }

      // Compute the top-level folder under api/src (e.g. 'functions', 'services')
      const relativePath = normalizePath(id).slice(apiSrc.length + 1)
      const apiFolder = relativePath.split('/')[0] ?? '?'

      const result = applyOtelWrapping(code, id, apiFolder)
      return result ? { code: result, map: null } : null
    },
  }
}

/**
 * Applies OpenTelemetry span wrapping to API source files.
 *
 * Exported as a standalone function so it can be tested without a Vite context.
 * Returns the transformed code string, or `null` if nothing was changed.
 */
export function applyOtelWrapping(
  code: string,
  filename: string,
  apiFolder: string,
): string | null {
  const parseResult = parseSync(filename, code, { sourceType: 'module' })

  // Collect replacements; we apply them in reverse order to preserve positions
  const replacements: { start: number; end: number; src: string }[] = []

  for (const node of parseResult.program.body) {
    if (node.type !== 'ExportNamedDeclaration') {
      continue
    }
    const decl = node.declaration
    if (decl?.type !== 'VariableDeclaration') {
      continue
    }
    const declarator = decl.declarations[0]
    if (!declarator) {
      continue
    }

    const fn = declarator.init as ArrowFunctionExpression | undefined
    if (fn?.type !== 'ArrowFunctionExpression') {
      continue
    }

    if (declarator.id.type !== 'Identifier') {
      continue
    }
    const fnName = declarator.id.name

    // Build the inner call argument list (without parameter defaults).
    // Returns null if any parameter type is unsupported — in that case we
    // skip this export rather than producing incorrect code.
    const innerArgs = buildInnerArgs(fn.params)
    if (innerArgs === null) {
      continue
    }

    // Everything from the start of the arrow function up to (but not including)
    // its body opening brace — e.g. "async ({ id }) => " or "({ id }) => ".
    // Used as the signature for both the outer wrapper and the inner function.
    const fnHeader = code.slice(fn.start, fn.body.start)

    // The complete original arrow function source (params + body).
    const originalFnSrc = code.slice(fn.start, fn.end)

    const isAsync = fn.async
    const awaitKw = isAsync ? 'await ' : ''
    const asyncKw = isAsync ? 'async ' : ''

    replacements.push({
      start: node.start,
      end: node.end,
      src: buildWrappedExport(
        fnName,
        fnHeader,
        originalFnSrc,
        innerArgs,
        awaitKw,
        asyncKw,
        apiFolder,
        filename,
      ),
    })
  }

  if (replacements.length === 0) {
    return null
  }

  // Apply in reverse so earlier replacements don't shift later positions
  let output = code
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    output = output.slice(0, r.start) + r.src + output.slice(r.end)
  }

  return (
    `import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'\n` +
    output
  )
}

/**
 * Constructs the argument list for the inner (private) function call,
 * stripping parameter defaults. Returns `null` if any param type is
 * unsupported (RestElement, ArrayPattern, TSParameterProperty).
 *
 * Examples:
 *   (id)              → "id"
 *   ({ id, name })    → "{ id, name }"
 *   ({ id = 1 })      → "{ id }"     (default stripped)
 *   (arg = 'default') → "arg"         (default stripped)
 */
function buildInnerArgs(params: ParamPattern[]): string | null {
  const args: string[] = []

  for (const param of params) {
    if (
      param.type === 'RestElement' ||
      param.type === 'ArrayPattern' ||
      param.type === 'TSParameterProperty'
    ) {
      return null
    }

    if (param.type === 'Identifier') {
      args.push(param.name)
      continue
    }

    if (param.type === 'ObjectPattern') {
      const obj = buildObjectCallArg(param)
      if (obj === null) {
        return null
      }
      args.push(obj)
      continue
    }

    if (param.type === 'AssignmentPattern') {
      const ap = param
      if (ap.left.type === 'Identifier') {
        args.push(ap.left.name)
      } else if (ap.left.type === 'ObjectPattern') {
        const obj = buildObjectCallArg(ap.left)
        if (obj === null) {
          return null
        }
        args.push(obj)
      } else {
        return null
      }
      continue
    }

    return null
  }

  return args.join(', ')
}

/**
 * Constructs an object-literal argument from an ObjectPattern, dropping any
 * RestElement entries (matching the Babel plugin's behaviour). Returns `null`
 * if any property key is non-identifier (computed, etc.).
 *
 * E.g. `{ id, name = 'Alice' }` → `"{ id, name }"`
 */
function buildObjectCallArg(pattern: ObjectPattern): string | null {
  const keys: string[] = []

  for (const prop of pattern.properties) {
    // Drop rest elements — matches the existing Babel plugin behaviour
    if (prop.type === 'RestElement') {
      continue
    }

    const bp = prop
    if (bp.key.type !== 'Identifier') {
      return null
    }
    keys.push(bp.key.name)
  }

  return `{ ${keys.join(', ')} }`
}

function buildWrappedExport(
  fnName: string,
  fnHeader: string,
  originalFnSrc: string,
  innerArgs: string,
  awaitKw: string,
  asyncKw: string,
  apiFolder: string,
  filename: string,
): string {
  const privateName = `__${fnName}`
  const spanName = `redwoodjs:api:${apiFolder}:${fnName}`

  // fnHeader already ends with "=> " so appending "{" opens the outer body
  return (
    `export const ${fnName} = ${fnHeader}{\n` +
    `  const ${privateName} = ${originalFnSrc}\n` +
    `  const RW_OTEL_WRAPPER_TRACER = RW_OTEL_WRAPPER_TRACE.getTracer('redwoodjs')\n` +
    `  const RW_OTEL_WRAPPER_RESULT = ${awaitKw}RW_OTEL_WRAPPER_TRACER.startActiveSpan(\n` +
    `    '${spanName}',\n` +
    `    ${asyncKw}(span) => {\n` +
    `      span.setAttribute('code.function', '${fnName}')\n` +
    `      span.setAttribute('code.filepath', ${JSON.stringify(filename)})\n` +
    `      try {\n` +
    `        const RW_OTEL_WRAPPER_INNER_RESULT = ${awaitKw}${privateName}(${innerArgs})\n` +
    `        span.end()\n` +
    `        return RW_OTEL_WRAPPER_INNER_RESULT\n` +
    `      } catch (error) {\n` +
    `        span.recordException(error)\n` +
    `        span.setStatus({\n` +
    `          code: 2,\n` +
    `          message:\n` +
    `            error?.message?.split('\\n')[0] ??\n` +
    `            error?.toString()?.split('\\n')[0],\n` +
    `        })\n` +
    `        span.end()\n` +
    `        throw error\n` +
    `      }\n` +
    `    }\n` +
    `  )\n` +
    `  return RW_OTEL_WRAPPER_RESULT\n` +
    `}`
  )
}
