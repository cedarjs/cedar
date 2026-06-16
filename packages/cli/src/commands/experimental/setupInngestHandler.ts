import execa from 'execa'
import { Listr } from 'listr2'

import { colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../../lib/index.js'

import { command, description, EXPERIMENTAL_TOPIC_ID } from './setupInngest.js'
import { printTaskEpilogue } from './util.js'

export const handler = async ({ force }: { force: boolean }) => {
  const tasks = new Listr([
    {
      title: `Adding Inngest setup packages for RedwoodJS ...`,
      task: async () => {
        await execa('yarn', ['add', '-D', 'inngest-setup-redwoodjs'], {
          cwd: getPaths().base,
        })
      },
    },
    {
      task: async () => {
        const pluginCommands = ['inngest-setup-redwoodjs', 'plugin']

        if (force) {
          pluginCommands.push('--force')
        }

        await execa('yarn', [...pluginCommands], {
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
