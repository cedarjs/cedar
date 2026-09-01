import path from 'node:path'

import { Listr } from 'listr2'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { oauthTasks } from './oauth-tasks.mts'

const args = yargs(hideBin(process.argv))
  .usage('Usage: $0 <project directory>')
  .parseSync()

/**
 * This script takes a regular test-project, and adds the OAuth identity
 * model, an OAuth-enabled auth function, and login-page buttons, so the
 * `dbauth-oauth` smoke test suite has something to run against.
 */
function runCommand() {
  const OUTPUT_PROJECT_PATH = path.resolve(String(args._))
  const tasks = oauthTasks(OUTPUT_PROJECT_PATH)
  const listr = new Listr(tasks, { exitOnError: true, renderer: 'verbose' })

  listr.run().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}

runCommand()
