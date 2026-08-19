import { files as layoutFiles } from '../../generate/layout/layoutHandler.js'
import { createHandler } from '../handlerHelpers.js'

export const { handler, tasks } = createHandler({
  componentName: 'layout',
  filesFn: layoutFiles,
})
