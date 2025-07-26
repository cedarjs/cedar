import { createHandler, createYargsForComponentDestroy } from '../helpers.js'

export const description = 'Destroy a component'
export const { command, builder, tasks } = createYargsForComponentDestroy({
  componentName: 'component',
})
export const handler = createHandler('component')
