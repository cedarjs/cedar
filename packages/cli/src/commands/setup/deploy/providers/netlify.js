import { createHandler } from '../helpers/helpers.js'

export const command = 'netlify'
export const description = 'Setup Netlify deploy'

export const builder = (yargs) =>
  yargs.option('ud', {
    description: 'Setup for use with Universal Deploy',
    type: 'boolean',
    default: false,
  })

export const handler = createHandler('netlify')
