import { terminalLink } from 'termi-link'

import c from '../lib/colors.js'
import { sides } from '../lib/project.js'

export const command = 'test [filter..]'
export const description = 'Run Vitest tests. Defaults to watch mode'
export const builder = (yargs) => {
  const cliDocsLink = terminalLink(
    'CedarJS CLI Reference',
    'https://cedarjs.com/docs/cli-commands#test',
  )
  const vitestTip = c.tip('yarn vitest --help')

  yargs
    .strict(false) // so that we can forward arguments to vitest
    .positional('filter', {
      default: sides(),
      description:
        'Which side(s) to test, and/or a regular expression to match against ' +
        'your test files to filter by',
      type: 'array',
    })
    .option('db-push', {
      describe:
        'Syncs the test database with your Prisma schema without requiring a ' +
        "migration. It creates a test database if it doesn't already exist.",
      type: 'boolean',
      default: true,
    })
    .epilogue(
      `For all available flags, run vitest cli directly ${vitestTip}\n\n` +
        `Also see the ${cliDocsLink}\n`,
    )
}

export const handler = async (options) => {
  const { handler } = await import('./testHandlerEsm.js')
  return handler(options)
}
