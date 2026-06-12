import {
  createBuilder,
  createCommand,
  createHandler,
} from '../yargsCommandHelpers.js'

export const command = createCommand('directive')
export const description = 'Generate a new GraphQL directive'
export const builder = createBuilder({ componentName: 'directive' })
export const handler = createHandler('directive')
