import type { Argv } from 'yargs'

import { createHandler } from '../helpers.js'

export const command = 'scaffold <model>'
export const description =
  'Destroy pages, SDL, and Services files based on a given DB schema Model'
export const builder = (yargs: Argv) => {
  yargs.positional('model', {
    description: 'Model to destroy the scaffold of',
    type: 'string',
  })
}
export const handler = createHandler('scaffold')
