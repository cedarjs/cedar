import { files as componentFiles } from '../../generate/component/componentHandler.js'
import { createHandler } from '../handlerHelpers.js'

export const { handler, tasks } = createHandler({
  componentName: 'component',
  filesFn: componentFiles,
})
