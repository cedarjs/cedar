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
 * This replaces `babel-plugin-redwood-context-wrapping` for Vite builds.
 * The babel plugin is still used for Jest and prerender.
 */
export function cedarContextWrappingPlugin({
  projectIsEsm = false,
}: {
  projectIsEsm?: boolean
} = {}): Plugin {
  // Captures: (1) const|let|var, (2) optional type annotation, (3) = with surrounding space
  // Examples: "export const handler =", "export const handler: SomeType =", "export const handler: Type[] ="
  const handlerRe = /^export\s+(const|let|var)\s+handler((?:\s*:[^=]*?)?)(\s*=)/m

  return {
    name: 'cedar-context-wrapping',

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

      const handlerMatch = handlerRe.exec(code)
      if (!handlerMatch) {
        return null
      }

      // Determine if the original handler init is an async function.
      // Matches the Babel plugin's check: t.isFunction(originalInit) && originalInit.async
      // Handles forms like: async (...), async(...), async function, /* comment */ async, etc.
      const afterEquals = code
        .slice(handlerMatch.index + handlerMatch[0].length)
        .trimStart()
      // Allow zero spaces between async and parenthesis to match async(...)
      const isAsync = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*async\s*[\(\*]/.test(afterEquals)

      const storePath = projectIsEsm
        ? '@cedarjs/context/dist/store.js'
        : '@cedarjs/context/dist/store'

      const importStatement = `import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '${storePath}'\n`

      // Insert the import just before the handler declaration, rename the
      // handler export to a private const, then append the wrapped export.
      const handlerStart = handlerMatch.index
      const before = code.slice(0, handlerStart)
      const after = code.slice(handlerStart)

      // Preserve type annotation (group 2) when renaming
      // Replace "export const handler [: Type] =" with "const __rw_handler [: Type] ="
      const renamed = after.replace(handlerRe, 'const __rw_handler$2$3')

      // Use rest parameters to forward all arguments including optional callback
      const wrappedHandler =
        `\nexport const handler = ${isAsync ? 'async ' : ''}(...__rw_args) => {\n` +
        `  // The store will be undefined if no context isolation has been performed yet\n` +
        `  const __rw_contextStore = __rw_getAsyncStoreInstance().getStore()\n` +
        `  if (__rw_contextStore === undefined) {\n` +
        `    return __rw_getAsyncStoreInstance().run(\n` +
        `      new Map(),\n` +
        `      __rw_handler,\n` +
        `      ...__rw_args\n` +
        `    )\n` +
        `  }\n` +
        `  return __rw_handler(...__rw_args)\n` +
        `}\n`

      return {
        code: before + importStatement + renamed + wrappedHandler,
        map: null,
      }
    },
  }
}
