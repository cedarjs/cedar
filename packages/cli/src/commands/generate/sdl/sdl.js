import terminalLink from 'terminal-link'

import { createHandler, yargsDefaults } from '../yargsCommandHelpers.js'

export const defaults = {
  ...yargsDefaults,
  crud: {
    default: true,
    description: 'Also generate mutations',
    type: 'boolean',
  },
}

export const command = 'sdl <model>'
export const description =
  'Generate a GraphQL schema and service component based on a given DB schema Model'
export const builder = (yargs) => {
  yargs
    .positional('model', {
      description: 'Model to generate the sdl for',
      type: 'string',
    })
    .option('tests', {
      description: 'Generate test files',
      type: 'boolean',
      // don't give it a default value, it gets overwritten in first few lines
      // of the handler
    })
    .option('docs', {
      description: 'Generate SDL and GraphQL comments to use in documentation',
      type: 'boolean',
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#generate-sdl',
      )}`,
    )

  // Merge default options in
  Object.entries(defaults).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}
export const handler = createHandler('sdl')
