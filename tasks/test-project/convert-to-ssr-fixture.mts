import path from 'node:path'

import { Listr } from 'listr2'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { streamingTasks } from './streaming-tasks.mts'

const args = yargs(hideBin(process.argv))
  .usage('Usage: $0 <project directory> [option]')
  .parseSync()

/**
 * This script runs a subset of tasks from the test-project.
 * It takes a regular test-project, and adds some extra files/config so we can
 * run e2e tests for ssr & streaming on it.
 */
function runCommand() {
  const OUTPUT_PROJECT_PATH = path.resolve(String(args._))
  const tasks = streamingTasks(OUTPUT_PROJECT_PATH)

  const listr = new Listr(tasks, {
    exitOnError: true,
    renderer: 'verbose',
  })

  listr.run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

runCommand()
