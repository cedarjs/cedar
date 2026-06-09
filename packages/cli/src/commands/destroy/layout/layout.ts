import { files as layoutFiles } from '../../generate/layout/layoutHandler.js'
import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const { command, description, builder } = createYargsForComponentDestroy(
  { componentName: 'layout', filesFn: layoutFiles },
)
export const handler = createHandler('layout')
