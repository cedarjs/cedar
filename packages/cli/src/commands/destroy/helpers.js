export const createYargsForComponentDestroy = ({ componentName }) => {
  return {
    command: `${componentName} <name>`,
    description: `Destroy a ${componentName} component`,
    builder: (yargs) => {
      yargs.positional('name', {
        description: `Name of the ${componentName}`,
        type: 'string',
      })
    },
  }
}

export function createHandler(componentName) {
  return async (argv) => {
    const importedHandler = await import(
      `./${componentName}/${componentName}Handler.js`
    )

    const fn =
      importedHandler.default ?? importedHandler.handler ?? importedHandler
    return typeof fn === 'function' ? fn(argv) : fn
  }
}
