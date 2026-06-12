import {
  createCommand,
  createBuilder,
  createHandler,
} from '../yargsCommandHelpers.js'

export const command = createCommand('component')
export const description = 'Generate a component'
export const builder = createBuilder({ componentName: 'component' })
export const handler = createHandler('component')
