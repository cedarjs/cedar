import type { Argv } from 'yargs'

import { createHandler } from '../helpers/helpers.js'

export const command = 'vercel'
export const description = 'Setup Vercel deploy'

export const builder = (yargs: Argv) =>
  yargs.option('ud', {
    description: 'Setup for use with Universal Deploy',
    type: 'boolean',
    default: false,
  })

export const handler = createHandler('vercel')
