// This file is safe to statically import in the CLI
import { terminalLink } from 'termi-link'

// Don't import anything here that isn't already imported by the CLI
import { isTypeScriptProject } from '@cedarjs/cli-helpers'

/**
 * Don't invoke this function at the top level of a file. Always call it within
 * a function or method.
 * The reason for this is that this in turn will call `isTypeScriptProject`,
 * and that has side effects that will break `cwd` functionality if called
 * before `cwd` is initialized.
 * @type {() => Record<string, import('yargs').Options>}
 */
export const getYargsDefaults = () => ({
  force: {
    alias: 'f',
    default: false,
    description: 'Overwrite existing files',
    type: 'boolean',
  },
  typescript: {
    alias: 'ts',
    default: isTypeScriptProject(),
    description: 'Generate TypeScript files',
    type: 'boolean',
  },
})

const appendPositionalsToCmd = (commandString, positionalsObj) => {
  // Add positionals like `page <name>` + ` [path]` if specified
  if (Object.keys(positionalsObj).length > 0) {
    const positionalNames = Object.keys(positionalsObj)
      .map((positionalName) => `[${positionalName}]`)
      .join(' ')
    // Note space after command is important
    return `${commandString} ${positionalNames}`
  } else {
    return commandString
  }
}

export function createCommand(componentName, positionalsObj = {}) {
  return appendPositionalsToCmd(`${componentName} <name>`, positionalsObj)
}

export function createDescription(componentName) {
  return `Generate a ${componentName} component`
}

export function createBuilder({ componentName, optionsObj, positionalsObj }) {
  return (yargs) => {
    yargs
      .positional('name', {
        description: `Name of the ${componentName}`,
        type: 'string',
      })
      .epilogue(
        `Also see the ${terminalLink(
          'CedarJS CLI Reference',
          `https://cedarjs.com/docs/cli-commands#generate-${componentName}`,
        )}`,
      )
      .option('tests', {
        description: 'Generate test files',
        type: 'boolean',
      })
      .option('stories', {
        description: 'Generate storybook files',
        type: 'boolean',
      })
      .option('verbose', {
        description: 'Print all logs',
        type: 'boolean',
        default: false,
      })
      .option('rollback', {
        description: 'Revert all generator actions if an error occurs',
        type: 'boolean',
        default: true,
      })

    // Add in passed in positionals
    Object.entries(positionalsObj || {}).forEach(([option, config]) => {
      yargs.positional(option, config)
    })

    const opts =
      typeof optionsObj === 'object'
        ? optionsObj
        : typeof optionsObj === 'function'
          ? optionsObj()
          : getYargsDefaults()

    // Add in passed in options
    Object.entries(opts).forEach(([option, config]) => {
      yargs.option(option, config)
    })
  }
}

export function createHandler(componentName) {
  return async function handler(argv) {
    const { handler: importedHandler } = await import(
      `./${componentName}/${componentName}Handler.js`
    )

    return importedHandler(argv)
  }
}
