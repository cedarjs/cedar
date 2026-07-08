// Handler ALS wrapping safeguard for API function handlers. This mirrors the
// Vite handlerAlsWrappingPlugin (used by buildCedarApp) and the Jest-only
// babel plugin it replaced. The legacy esbuild build and the standalone-Vite
// build (buildApiWithVite) don't go through the Vite plugin pipeline, so they
// apply it directly here. Keep this in sync with
// packages/vite/src/plugins/vite-plugin-handler-als-wrapping.ts.

export function applyHandlerAlsWrapping(
  code: string,
  { projectIsEsm = false }: { projectIsEsm?: boolean } = {},
): string | null {
  const handlerRe =
    /^export\s+(?:const|let|var)\s+handler(?:[^=]|=>)*?=(?![>=])/m

  const handlerMatch = handlerRe.exec(code)
  if (!handlerMatch) {
    return null
  }

  const afterEquals = code
    .slice(handlerMatch.index + handlerMatch[0].length)
    .trimStart()
  const isAsync = /^async(?:\s*[\(\*]|\s+function)/.test(afterEquals)

  const storePath = projectIsEsm
    ? '@cedarjs/context/dist/store.js'
    : '@cedarjs/context/dist/store'

  const importStatement = `import { getAsyncStoreInstance as __rw_getAsyncStoreInstance } from '${storePath}'\n`

  const handlerStart = handlerMatch.index
  const before = code.slice(0, handlerStart)
  const after = code.slice(handlerStart)

  const renamed = after.replace(handlerRe, 'const __rw_handler =')

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
