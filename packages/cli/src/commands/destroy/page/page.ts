import type { Argv } from 'yargs'

import { createHandler } from '../helpers.js'

export const command = 'page <name> [path]'
export const description = 'Destroy a page and route component'
export const builder = (yargs: Argv) => {
  yargs.positional('name', {
    description: 'Name of the page',
    type: 'string',
  })
  yargs.positional('path', {
    description: 'URL path to the page. Defaults to name',
    type: 'string',
  })
}
export const handler = createHandler('page')
