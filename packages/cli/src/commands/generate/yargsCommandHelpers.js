// This file is safe to statically import in the CLI
import terminalLink from 'terminal-link'

// Don't import anything here that isn't already imported by the CLI
import { isTypeScriptProject } from '@redmix/cli-helpers'

/** @type {Record<string, import('yargs').Options>} */
export const yargsDefaults = {
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
}

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

export function createBuilder({
  componentName,
  optionsObj = yargsDefaults,
  positionalsObj = {},
}) {
  return (yargs) => {
    yargs
      .positional('name', {
        description: `Name of the ${componentName}`,
        type: 'string',
      })
      .epilogue(
        `Also see the ${terminalLink(
          'Redwood CLI Reference',
          `https://redwoodjs.com/docs/cli-commands#generate-${componentName}`,
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
    Object.entries(positionalsObj).forEach(([option, config]) => {
      yargs.positional(option, config)
    })

    // Add in passed in options
    Object.entries(optionsObj).forEach(([option, config]) => {
      yargs.option(option, config)
    })
  }
}

export function createHandler(componentName) {
  return async function handler(argv) {
    const { handler: importedHandler } = await import(
      `./${componentName}Handler.js`
    )

    return importedHandler(argv)
  }
}
