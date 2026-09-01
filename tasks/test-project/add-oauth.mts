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
  // `args._` collects every positional argument; `String()` on the array
  // would silently join zero args into `''` or several into `'a,b'`
  // instead of failing, resolving to a nonsensical project path.
  if (args._.length !== 1) {
    console.error('Usage: add-oauth.mts <project directory>')
    process.exit(1)
  }

  const OUTPUT_PROJECT_PATH = path.resolve(String(args._[0]))
  const tasks = oauthTasks(OUTPUT_PROJECT_PATH)
  const listr = new Listr(tasks, { exitOnError: true, renderer: 'verbose' })

  listr.run().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}

runCommand()
