import { files as functionFiles } from '../../generate/function/functionHandler.js'
import { createHandler } from '../handlerHelpers.js'

export const { handler, tasks } = createHandler({
  componentName: 'function',
  filesFn: functionFiles,
})
