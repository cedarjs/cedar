import type { Options } from 'yargs'

import {
  createCommand,
  createDescription,
  createBuilder,
  createHandler,
  getYargsDefaults,
} from '../yargsCommandHelpers.js'

const optionsObj = (): Record<string, Options> => ({
  skipLink: {
    default: false,
    description: 'Generate with skip link',
    type: 'boolean',
  },
  ...getYargsDefaults(),
})

export const command = createCommand('layout')
export const description = createDescription('layout')
export const builder = createBuilder({ componentName: 'layout', optionsObj })
export const handler = createHandler('layout')
