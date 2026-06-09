import { files as directiveFiles } from '../../generate/directive/directiveHandler.js'
import { createYargsForComponentDestroy, createHandler } from '../helpers.js'

export const description = 'Destroy a directive'
export const { command, builder } = createYargsForComponentDestroy({
  componentName: 'directive',
  filesFn: (args) => directiveFiles({ ...args, type: 'validator' }),
})
export const handler = createHandler('directive')
