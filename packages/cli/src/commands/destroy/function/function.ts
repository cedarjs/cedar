import type { Argv } from 'yargs'

import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const description = 'Destroy a Function'

export const builder = (yargs: Argv) => {
  yargs.positional('name', {
    description: 'Name of the Function',
    type: 'string',
  })
}

export const { command } = createYargsForComponentDestroy({
  componentName: 'function',
})

export const handler = createHandler('function')
