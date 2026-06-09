import type { Argv } from 'yargs'

interface CreateYargsOptions {
  componentName: string
  filesFn?: (args: Record<string, unknown>) => Promise<Record<string, string>>
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
    const importedHandler = await import(
      `./${componentName}/${componentName}Handler.js`
    )

    const fn =
      importedHandler.default ?? importedHandler.handler ?? importedHandler
    return typeof fn === 'function' ? fn(argv) : fn
  }
}
