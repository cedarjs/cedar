import { getDefaultArgs } from '../../../lib/index.js'
import { verifyModelName } from '../../../lib/schemaHelpers.js'
import { builder } from '../../generate/service/service.js'
import { files } from '../../generate/service/serviceHandler.js'
import { createHandler } from '../handlerHelpers.js'

// This function wraps files(), so we can pass templateVars. templateVars
// referenced in a file template must be defined, otherwise template rendering
// fails. This way we can pass stub values for templateVars and do not define
// fake builder flags for destroy command just to make templates work.
//
// Better solution would be to split file paths resolving and template
// rendering into separate functions. See more in this PR discussion:
// https://github.com/redwoodjs/redwood/pull/487#issue-411204396
const filesWithTemplateVars = (templateVars: Record<string, unknown>) => {
  return (args: Record<string, unknown>) => files({ ...args, ...templateVars })
}

export const { handler, tasks } = createHandler({
  componentName: 'service',
  preTasksFn: verifyModelName,
  filesFn: filesWithTemplateVars({ ...getDefaultArgs(builder), crud: true }),
})
