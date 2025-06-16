import { terminalLink } from 'termi-link'

import { createHandler, getYargsDefaults } from '../yargsCommandHelpers.js'

export const command = 'model <name>'
export const description = 'Generate a RedwoodRecord model'
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'Name of the model to create',
      type: 'string',
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'RedwoodRecord Reference',
        'https://redwoodjs.com/docs/redwoodrecord',
      )}`,
    )

  Object.entries(getYargsDefaults()).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}
export const handler = createHandler('model')
