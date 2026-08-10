import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'

import { deleteFilesTask } from '../../../lib/index.js'
import { verifyModelName } from '../../../lib/schemaHelpers.js'
import { files } from '../../generate/sdl/sdlHandler.js'

export const tasks = ({ model }: { model: string }) =>
  new Listr(
    [
      {
        title: 'Destroying GraphQL schema and service component files...',
        task: async () => {
          // `stubModels: []` so we only ever destroy the named model's own
          // files, never stubs generated for related models
          const f = await files({ name: model, stubModels: [] })
          return deleteFilesTask(f)
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export const handler = async ({ model }: { model: string }) => {
  recordTelemetryAttributes({
    command: 'destroy sdl',
  })
  try {
    const { name } = await verifyModelName({ name: model, isDestroyer: true })
    await tasks({ model: name }).run()
  } catch (e) {
    console.log(c.error(e instanceof Error ? e.message : String(e)))
  }
}
