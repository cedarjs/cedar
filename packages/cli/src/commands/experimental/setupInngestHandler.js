import { Listr } from 'listr2'

import {
  addRootPackages,
  getPackageManager,
  runBin,
  runPackageManagerCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../lib/colors.js'
import { getPaths } from '../../lib/index.js'

import { command, description, EXPERIMENTAL_TOPIC_ID } from './setupInngest.js'
import { printTaskEpilogue } from './util.js'

export const handler = async ({ force }) => {
  const pm = getPackageManager()
  const tasks = new Listr([
    {
      title: `Adding Inngest setup packages for RedwoodJS ...`,
      task: async () => {
        await runPackageManagerCommand(
          addRootPackages(['inngest-setup-redwoodjs'], pm, { dev: true }),
          { cwd: getPaths().base },
        )
      },
    },
    {
      task: async () => {
        const pluginArgs = ['plugin']

        if (force) {
          pluginArgs.push('--force')
        }

        await runPackageManagerCommand(
          runBin('inngest-setup-redwoodjs', pluginArgs, pm),
          {
            stdout: 'inherit',
            cwd: getPaths().base,
          },
        )
      },
    },
    {
      task: () => {
        printTaskEpilogue(command, description, EXPERIMENTAL_TOPIC_ID)
      },
    },
  ])

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
