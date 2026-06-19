import path from 'node:path'

import { paramCase } from 'change-case'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { formatCedarCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getDataMigrationsPath } from '@cedarjs/project-config'

import {
  generateTemplate,
  getPaths,
  writeFilesTask,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { getYargsDefaults } from '../yargsCommandHelpers.js'

export function getPostRunInstructions() {
  const text = c.warning('After writing your migration, you can run it with:')
  const command = formatCedarCommand(['dataMigrate', 'up'])

  return `Next steps...\n\n   ${text}\n\n   ${command}\n`
}

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

interface FilesArgs {
  name: string
  typescript: boolean
}

export const files = async ({ name, typescript }: FilesArgs) => {
  const now = new Date().toISOString()
  const timestamp = now.split('.')[0].replace(/\D/g, '')
  const basename = `${timestamp}-${paramCase(name)}`
  const extension = typescript ? 'ts' : 'js'
  const outputFilename = basename + '.' + extension
  const dataMigrationsPath = await getDataMigrationsPath(
    getPaths().api.prismaConfig,
  )
  const outputPath = path.join(dataMigrationsPath, outputFilename)

  const prismaImportSource = 'src/lib/db'

  return {
    [outputPath]: await generateTemplate(TEMPLATE_PATHS[extension], {
      name,
      prismaImportSource,
    }),
  }
}

export const command = 'data-migration <name>'
export const aliases = ['dataMigration', 'dm']
export const description = 'Generate a data migration'
export const builder = (yargs: Argv) => {
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

interface HandlerArgs {
  name: string
  force: boolean
  rollback: boolean
  typescript: boolean
}

export const handler = async (args: HandlerArgs) => {
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
        task: async () => {
          return writeFilesTask(await files(args))
        },
      },
      {
        title: 'Next steps...',
        task: (_ctx, task) => {
          task.title = getPostRunInstructions()
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
    console.log(c.error(e instanceof Error ? e.message : String(e)))
    process.exit(1)
  }
}
