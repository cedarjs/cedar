import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const { command, description, builder } = createYargsForComponentDestroy(
  { componentName: 'cell' },
)
export const handler = createHandler('cell')
