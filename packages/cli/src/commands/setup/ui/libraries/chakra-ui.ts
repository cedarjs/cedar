import type { Argv } from 'yargs'

import { createHandler } from '../helpers/helpers.js'

export const command = 'chakra-ui'
export const description = 'Set up Chakra UI'

export function builder(yargs: Argv) {
  yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
  yargs.option('install', {
    alias: 'i',
    default: true,
    description: 'Install packages',
    type: 'boolean',
  })
}

export const handler = createHandler(command)
