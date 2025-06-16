import { terminalLink } from 'termi-link'

import {
  createCommand,
  createDescription,
  createHandler,
  getYargsDefaults,
} from '../yargsCommandHelpers.js'

export const defaults = () => {
  const defaults = {
    ...getYargsDefaults(),
    tests: {
      description: 'Generate test files',
      type: 'boolean',
    },
    crud: {
      default: true,
      description: 'Create CRUD functions',
      type: 'boolean',
    },
  }
  return defaults
}

export const command = createCommand('service')
export const description = createDescription('service')
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'Name of the service',
      type: 'string',
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#generate-service',
      )}`,
    )
  Object.entries(defaults()).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}
export const handler = createHandler('service')
