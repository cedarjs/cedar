import path from 'path'

import { paramCase } from 'change-case'
import fs from 'fs-extra'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import c from '../../../lib/colors.js'
import { getPaths, writeFilesTask } from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { getYargsDefaults } from '../yargsCommandHelpers.js'

const POST_RUN_INSTRUCTIONS = `Next steps...\n\n   ${c.warning(
  'After writing your migration, you can run it with:',
)}

     yarn rw dataMigrate up
`

const TEMPLATE_PATHS = {
  js: path.resolve(
    import.meta.dirname,
    'templates',
    'dataMigration.js.template',
  ),
  ts: path.resolve(
    import.meta.dirname,
    'templates',
    'dataMigration.ts.template',
  ),
}

export const files = ({ name, typescript }) => {
  const now = new Date().toISOString()
  const timestamp = now.split('.')[0].replace(/\D/g, '')
  const basename = `${timestamp}-${paramCase(name)}`
  const extension = typescript ? 'ts' : 'js'
  const outputFilename = basename + '.' + extension
  const outputPath = path.join(getPaths().api.dataMigrations, outputFilename)

  return {
    [outputPath]: fs.readFileSync(TEMPLATE_PATHS[extension]).toString(),
  }
}

export const command = 'data-migration <name>'
export const aliases = ['dataMigration', 'dm']
export const description = 'Generate a data migration'
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'A descriptor of what this data migration does',
      type: 'string',
    })
    .option('rollback', {
      description: 'Revert all generator actions if an error occurs',
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#generate-datamigration',
      )}`,
    )

  // Merge generator defaults in
  Object.entries(getYargsDefaults()).forEach(([option, config]) => {
    yargs.option(option, config)
  })
}

export const handler = async (args) => {
  recordTelemetryAttributes({
    command: 'generate data-migration',
    force: args.force,
    rollback: args.rollback,
  })

  validateName(args.name)

  const tasks = new Listr(
    [
      {
        title: 'Generating data migration file...',
        task: () => {
          return writeFilesTask(files(args))
        },
      },
      {
        title: 'Next steps...',
        task: (_ctx, task) => {
          task.title = POST_RUN_INSTRUCTIONS
        },
      },
    ].filter(Boolean),
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    if (args.rollback && !args.force) {
      prepareForRollback(tasks)
    }
    await tasks.run()
  } catch (e) {
    console.log(c.error(e.message))
    process.exit(1)
  }
}
