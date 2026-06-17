import { files as directiveFiles } from '../../generate/directive/directiveHandler.js'
import { createHandler } from '../handlerHelpers.js'

export const { handler, tasks } = createHandler({
  componentName: 'directive',
  filesFn: (args) => directiveFiles({ ...args, type: 'validator' }),
})
