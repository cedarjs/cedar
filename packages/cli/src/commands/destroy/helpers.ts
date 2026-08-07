import type { Argv } from 'yargs'

interface CreateYargsOptions {
  componentName: string
}

export const createYargsForComponentDestroy = ({
  componentName,
}: CreateYargsOptions) => {
  return {
    command: `${componentName} <name>`,
    description: `Destroy a ${componentName} component`,
    builder: (yargs: Argv) => {
      yargs.positional('name', {
        description: `Name of the ${componentName}`,
        type: 'string',
      })
    },
  }
}

export function createHandler(componentName: string) {
  return async (argv: Record<string, unknown>) => {
    // The handler file may be `.js` or `.ts` depending on whether it has been
    // migrated to TypeScript yet. The built dist compiles everything to `.js`,
    // so we try `.js` first (matching production) and fall back to `.ts` for
    // vitest runs against the source tree.
    const { existsSync } = await import('node:fs')
    const tsPath = `./${componentName}/${componentName}Handler.ts`
    const jsPath = `./${componentName}/${componentName}Handler.js`
    const resolvedPath = existsSync(new URL(tsPath, import.meta.url))
      ? tsPath
      : jsPath
    const importedHandler = await import(resolvedPath)

    const fn =
      importedHandler.default ?? importedHandler.handler ?? importedHandler
    return typeof fn === 'function' ? fn(argv) : fn
  }
}
