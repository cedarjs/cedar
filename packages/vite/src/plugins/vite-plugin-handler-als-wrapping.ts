import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

/**
 * Vite plugin that wraps user API functions to ensure context isolation has
 * been performed. This should already be done at the request level but in
 * serverless environments like Netlify we need to do this at the function
 * level as a safeguard.
 *
 * For each file in `api/src/functions/` that exports a `handler`, this plugin:
 *
 * 1. Adds an import at the top of the file:
 *      import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '@cedarjs/context/dist/store'
 *
 * 2. Renames the original handler:
 *      const __rw_handler = <original handler value>
 *
 * 3. Replaces the handler export with a wrapper that checks context isolation:
 *      export const handler = (__rw_event, __rw__context) => {
 *        const __rw_contextStore = __rw_getAsyncStoreInstance().getStore()
 *        if (__rw_contextStore === undefined) {
 *          return __rw_getAsyncStoreInstance().run(new Map(), __rw_handler, __rw_event, __rw__context)
 *        }
 *        return __rw_handler(__rw_event, __rw__context)
 *      }
 *
 * This replaces `babel-plugin-handler-als-wrapping` for Vite builds.
 * The babel plugin is still used for Jest and prerender.
 */
export function handlerAlsWrappingPlugin({
  projectIsEsm = false,
}: {
  projectIsEsm?: boolean
} = {}): Plugin {
  return {
    name: 'handler-als-wrapping',

    transform(code, id) {
      // Only transform API function files
      let paths: ReturnType<typeof getPaths>
      try {
        paths = getPaths()
      } catch {
        return null
      }

      const functionsDir = normalizePath(path.join(paths.api.src, 'functions'))

      if (!normalizePath(id).startsWith(functionsDir + '/')) {
        return null
      }

      const wrapped = applyHandlerAlsWrapping(code, { projectIsEsm })
      return wrapped ? { code: wrapped, map: null } : null
    },
  }
}

/**
 * Wraps the `handler` export of an API function file with an async context
 * store guard. Returns the transformed code, or `null` if the file does not
 * export a `handler`.
 *
 * This is the context-isolation safeguard that used to be performed by
 * `babel-plugin-handler-als-wrapping`. It is exported as a standalone
 * function so it can be applied from build pipelines that don't go through
 * Vite's plugin pipeline (e.g. the legacy esbuild API build).
 */
export function applyHandlerAlsWrapping(
  code: string,
  { projectIsEsm = false }: { projectIsEsm?: boolean } = {},
): string | null {
  // Matches the full export declaration up to (and including) the assignment =.
  // (?:[^=]|=>)* handles => inside TypeScript function type annotations without backtracking issues.
  // The final = is matched only when not part of => or == (lookahead (?![>=])).
  const handlerRe =
    /^export\s+(?:const|let|var)\s+handler(?:[^=]|=>)*?=(?![>=])/m

  const handlerMatch = handlerRe.exec(code)
  if (!handlerMatch) {
    return null
  }

  // Determine if the original handler init is an async function.
  // Matches the Babel plugin's check: t.isFunction(originalInit) && originalInit.async
  // Handles: async (...) => {}, async(...) => {}, async function() {}, async *gen() {}
  const afterEquals = code
    .slice(handlerMatch.index + handlerMatch[0].length)
    .trimStart()
  const isAsync = /^async(?:\s*[\(\*]|\s+function)/.test(afterEquals)

  const storePath = projectIsEsm
    ? '@cedarjs/context/dist/store.js'
    : '@cedarjs/context/dist/store'

  const importStatement = `import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '${storePath}'\n`

  // Insert the import just before the handler declaration, rename the
  // handler export to a private const, then append the wrapped export.
  const handlerStart = handlerMatch.index
  const before = code.slice(0, handlerStart)
  const after = code.slice(handlerStart)

  // Replace "export const handler [: Type] =" with "const __rw_handler ="
  // Type annotation is dropped here, matching the Babel plugin which creates a fresh
  // variableDeclarator with just the identifier and init (no type annotation).
  const renamed = after.replace(handlerRe, 'const __rw_handler =')

  // Wrapper matches Babel's generateWrappedHandler exactly: explicit (__rw_event, __rw__context)
  const wrappedHandler =
    `\nexport const handler = ${isAsync ? 'async ' : ''}(__rw_event, __rw__context) => {\n` +
    `  // The store will be undefined if no context isolation has been performed yet\n` +
    `  const __rw_contextStore = __rw_getAsyncStoreInstance().getStore()\n` +
    `  if (__rw_contextStore === undefined) {\n` +
    `    return __rw_getAsyncStoreInstance().run(\n` +
    `      new Map(),\n` +
    `      __rw_handler,\n` +
    `      __rw_event,\n` +
    `      __rw__context\n` +
    `    )\n` +
    `  }\n` +
    `  return __rw_handler(__rw_event, __rw__context)\n` +
    `}\n`

  return before + importStatement + renamed + wrappedHandler
}
