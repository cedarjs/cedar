import type { Options } from 'yargs'

import {
  createCommand,
  createDescription,
  createBuilder,
  getYargsDefaults,
  createHandler,
} from '../yargsCommandHelpers.js'

export const command = createCommand('cell')
export const description = createDescription('cell')
export const builder = createBuilder({
  componentName: 'cell',
  optionsObj: (): Record<string, Options> => {
    return {
      ...getYargsDefaults(),
      list: {
        alias: 'l',
        default: false,
        description:
          'Use when you want to generate a cell for a list of the model name.',
        type: 'boolean',
      },
      query: {
        default: '',
        description:
          'Use to enforce a specific query name within the generated cell - must be unique.',
        type: 'string',
      },
      beforeQuery: {
        default: false,
        description:
          'Include a typed `beforeQuery` stub for configuring the query (e.g. variables, fetch policy).',
        type: 'boolean',
      },
      afterQuery: {
        default: false,
        description:
          'Include a typed `afterQuery` stub for sanitizing data returned from the query.',
        type: 'boolean',
      },
      isEmpty: {
        default: false,
        description:
          'Include a typed `isEmpty` stub for overriding the default check for the Empty component.',
        type: 'boolean',
      },
    }
  },
})
export const handler = createHandler('cell')
