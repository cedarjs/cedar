import { files as directiveFiles } from '../../generate/directive/directiveHandler.js'
import { createHandler } from '../handlerHelpers.js'

export const description = 'Destroy a directive'

export const { builder, tasks } = createHandler({
  componentName: 'directive',
  filesFn: (args) => directiveFiles({ ...args, type: 'validator' }),
})
