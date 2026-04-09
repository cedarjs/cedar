import path from 'path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { colors as c } from '@cedarjs/cli-helpers'
import {
  getPaths,
  writeFilesTask,
  generateTemplate,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { verifyModelName } from '../../../lib/schemaHelpers.js'
import { validateName } from '../helpers.js'
const TEMPLATE_PATH = path.resolve(
  import.meta.dirname,
  'templates',
  'model.js.template',
)

const files = async ({ name, typescript = false }) => {
  const outputFilename = `${name}.${typescript ? 'ts' : 'js'}`
  const outputPath = path.join(getPaths().api.models, outputFilename)

  return {
    [outputPath]: await generateTemplate(TEMPLATE_PATH, { name }),
  }
}

export const handler = async ({ force, ...args }) => {
  recordTelemetryAttributes({
    command: 'generate model',
    force,
    rollback: args.rollback,
  })

  validateName(args.name)

  const tasks = new Listr(
    [
      {
        title: 'Generating model file...',
        task: async () => {
          return writeFilesTask(await files(args), { overwriteExisting: force })
        },
      },
      {
        title: 'Parsing datamodel, generating api/src/models/index.js...',
        task: async () => {
          const redwoodRecordModule = await import('@cedarjs/record')
          await redwoodRecordModule.default.parseDatamodel()
        },
      },
    ].filter(Boolean),
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    await verifyModelName({ name: args.name })
    if (args.rollback && !force) {
      prepareForRollback(tasks)
    }
    await tasks.run()
  } catch (e) {
    console.log(c.error(e.message))
    process.exit(1)
  }
}
