import { Listr } from 'listr2'

import { colors as c } from '@cedarjs/cli-helpers'
import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { addRootPackages } from '@cedarjs/cli-helpers/packageManager/packages'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../../lib/index.js'

import { command, description, EXPERIMENTAL_TOPIC_ID } from './setupInngest.js'
import { printTaskEpilogue } from './util.js'

export const handler = async ({ force }: { force: boolean }) => {
  const tasks = new Listr([
    {
      title: `Adding Inngest setup packages for RedwoodJS ...`,
      task: async () => {
        await addRootPackages(['inngest-setup-redwoodjs'], {
          cwd: getPaths().base,
          dev: true,
        })
      },
    },
    {
      task: async () => {
        const pluginArgs = force ? ['--force'] : []

        await runBin('inngest-setup-redwoodjs', ['plugin', ...pluginArgs], {
          stdout: 'inherit',
          cwd: getPaths().base,
        })
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
    const message = e instanceof Error ? e.message : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    process.exit(exitCode)
  }
}
