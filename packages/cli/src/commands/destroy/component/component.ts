import { createHandler, createYargsForComponentDestroy } from '../helpers.js'

export const description = 'Destroy a component'
export const { command, builder } = createYargsForComponentDestroy({
  componentName: 'component',
})
export const handler = createHandler('component')
