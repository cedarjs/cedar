import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const description = 'Destroy a directive'
export const { command, builder } = createYargsForComponentDestroy({
  componentName: 'directive',
})
export const handler = createHandler('directive')
