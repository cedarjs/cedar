export function createHandler(componentName: string) {
  return async function handler(argv: Record<string, unknown>) {
    // The handler file may be `.js` or `.ts` depending on whether it has been
    // migrated to TypeScript yet. The built dist compiles everything to `.js`,
    // so we try `.js` first (matching production) and fall back to `.ts` for
    // vitest runs against the source tree.
    const { existsSync } = await import('node:fs')
    const tsPath = `../providers/${componentName}Handler.ts`
    const jsPath = `../providers/${componentName}Handler.js`
    const resolvedPath = existsSync(new URL(tsPath, import.meta.url))
      ? tsPath
      : jsPath
    const { handler: importedHandler } = await import(resolvedPath)

    return importedHandler(argv)
  }
}
