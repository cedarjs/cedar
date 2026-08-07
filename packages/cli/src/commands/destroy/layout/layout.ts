import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const { command, description, builder } = createYargsForComponentDestroy(
  { componentName: 'layout' },
)
export const handler = createHandler('layout')
