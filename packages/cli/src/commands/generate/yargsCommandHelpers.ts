// This file is safe to statically import in the CLI
import { terminalLink } from 'termi-link'
import type { Argv, Options, PositionalOptions } from 'yargs'

// Don't import anything here that isn't already imported by the CLI
import { isTypeScriptProject } from '@cedarjs/cli-helpers'

/**
 * Don't invoke this function at the top level of a file. Always call it within
 * a function or method.
 * The reason for this is that this in turn will call `isTypeScriptProject`,
 * and that has side effects that will break `cwd` functionality if called
 * before `cwd` is initialized.
 */
export const getYargsDefaults = (): Record<string, Options> => ({
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

const appendPositionalsToCmd = (
  commandString: string,
  positionalsObj: Record<string, PositionalOptions>,
) => {
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

export function createCommand(
  componentName: string,
  positionalsObj: Record<string, PositionalOptions> = {},
) {
  return appendPositionalsToCmd(`${componentName} <name>`, positionalsObj)
}

export function createDescription(componentName: string) {
  return `Generate a ${componentName} component`
}

interface CreateBuilderOptions {
  componentName: string
  optionsObj?: Record<string, Options> | (() => Record<string, Options>)
  positionalsObj?: Record<string, PositionalOptions>
}

export function createBuilder({
  componentName,
  optionsObj,
  positionalsObj,
}: CreateBuilderOptions) {
  return (yargs: Argv) => {
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

export function createHandler(componentName: string) {
  return async function handler(argv: any) {
    const { handler: importedHandler } = await import(
      `./${componentName}/${componentName}Handler.js`
    )

    return importedHandler(argv)
  }
}
