import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { colors as c } from '@cedarjs/cli-helpers'
import { deleteFilesTask } from '../../../lib/index.js'
import { verifyModelName } from '../../../lib/schemaHelpers.js'
import { files } from '../../generate/sdl/sdlHandler.js'

export const tasks = ({ model }) =>
  new Listr(
    [
      {
        title: 'Destroying GraphQL schema and service component files...',
        task: async () => {
          const f = await files({ name: model })
          return deleteFilesTask(f)
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export const handler = async ({ model }) => {
  recordTelemetryAttributes({
    command: 'destroy sdl',
  })
  try {
    const { name } = await verifyModelName({ name: model, isDestroyer: true })
    await tasks({ model: name }).run()
  } catch (e) {
    console.log(c.error(e.message))
  }
}
