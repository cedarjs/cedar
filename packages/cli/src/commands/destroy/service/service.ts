import { createHandler, createYargsForComponentDestroy } from '../helpers.js'

export const { command, description } = createYargsForComponentDestroy({
  componentName: 'service',
})
export const handler = createHandler('service')
