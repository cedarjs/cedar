import { createHandler } from '../helpers/helpers.js'

export const command = 'tailwind4'
export const aliases = ['tw4']
export const description = 'Set up tailwind v4 for vite projects'

export const builder = (yargs) => {
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
