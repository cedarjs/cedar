import terminalLink from 'terminal-link'

import { createHandler, yargsDefaults } from '../yargsCommandHelpers.js'

export const command = 'script <name>'
export const description = 'Generate a command line script'
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'A descriptor of what this script does',
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
        'https://redwoodjs.com/docs/cli-commands#generate-script',
      )}`,
    )

  Object.entries(yargsDefaults).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}
export const handler = createHandler('script')
