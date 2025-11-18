import camelcase from 'camelcase'
import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import c from '../../../lib/colors.js'
import {
  deleteFilesTask,
  removeRoutesFromRouterTask,
} from '../../../lib/index.js'
import { pathName } from '../../generate/helpers.js'
import {
  files as pageFiles,
  paramVariants as templateVars,
} from '../../generate/page/pageHandler.js'

export const tasks = ({ name, path }) =>
  new Listr(
    [
      {
        title: 'Destroying page files...',
        task: async () => {
          const p = pathName(path, name)
          const f = await pageFiles({
            name,
            path: p,
            stories: true,
            tests: true,
            ...templateVars(p),
          })
          return deleteFilesTask(f)
        },
      },
      {
        title: 'Cleaning up routes file...',
        task: async () => removeRoutesFromRouterTask([camelcase(name)]),
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export const handler = async ({ name, path }) => {
  recordTelemetryAttributes({
    command: 'destroy page',
  })
  const t = tasks({ name, path })
  try {
    await t.run()
  } catch (e) {
    console.log(c.error(e.message))
  }
}
