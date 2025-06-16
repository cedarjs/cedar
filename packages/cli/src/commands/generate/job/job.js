import { terminalLink } from 'termi-link'

import { isTypeScriptProject } from '../../../lib/project.js'
import { getYargsDefaults, createHandler } from '../yargsCommandHelpers.js'

export const command = 'job <name>'
export const description = 'Generate a Background Job'

// This could be built using createYargsForComponentGeneration;
// however, functions shouldn't have a `stories` option. createYargs...
// should be reversed to provide `getYargsDefaults` as the default configuration
// and accept a configuration such as its CURRENT default to append onto a command.
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'Name of the Job',
      type: 'string',
    })
    .option('typescript', {
      alias: 'ts',
      description: 'Generate TypeScript files',
      type: 'boolean',
      default: isTypeScriptProject(),
    })
    .option('tests', {
      description: 'Generate test files',
      type: 'boolean',
      default: true,
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#generate-job',
      )}`,
    )

  // Add default options. This includes '--typescript', '--javascript',
  // '--force', ...
  Object.entries(getYargsDefaults()).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}

export const handler = createHandler('job')
