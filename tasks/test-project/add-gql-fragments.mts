import path from 'node:path'

import { Listr } from 'listr2'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { fragmentsTasks } from './fragments-tasks.mts'

const args = yargs(hideBin(process.argv))
  .usage('Usage: $0 <project directory>')
  .parseSync()

/**
 * This script takes a regular test-project, and adds some extra files/config
 * so we can run e2e tests for fragments
 */
function runCommand() {
  const OUTPUT_PROJECT_PATH = path.resolve(String(args._))
  const tasks = fragmentsTasks(OUTPUT_PROJECT_PATH)
  const listr = new Listr(tasks, { exitOnError: true, renderer: 'verbose' })

  listr.run().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}

runCommand()
