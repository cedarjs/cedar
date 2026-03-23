import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import {
  formatRunBinCommand,
  getPackageManager,
} from '@cedarjs/cli-helpers/packageManager'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { workspaces } from '../lib/project.js'

export const command = 'test [filter..]'
export const description = 'Run Vitest tests. Defaults to watch mode'
export const builder = (yargs: Argv) => {
  const cliDocsLink = terminalLink(
    'CedarJS CLI Reference',
    'https://cedarjs.com/docs/cli-commands#test',
  )
  const vitestTip = c.tip(
    formatRunBinCommand('vitest', ['--help'], getPackageManager()),
  )

  yargs
    .strict(false) // so that we can forward arguments to vitest
    .positional('filter', {
      default: workspaces(),
      description:
        'Which side(s) to test, and/or a regular expression to match against ' +
        'your test files to filter by',
      type: 'string',
      array: true,
    })
    .option('db-push', {
      describe:
        'Syncs the test database with your Prisma schema without requiring a ' +
        "migration. It creates a test database if it doesn't already exist.",
      type: 'boolean',
      default: true,
    })
    .option('force', {
      describe:
        'Skip any confirmation prompts and run tests without interruption. ' +
        'Useful in CI or scripted environments.',
      type: 'boolean',
      default: false,
    })
    .epilogue(
      `For all available flags, run vitest cli directly ${vitestTip}\n\n` +
        `Also see the ${cliDocsLink}\n`,
    )
}

export const handler = async (options: Record<string, unknown>) => {
  const { handler } = await import('./test/testHandlerEsm.js')
  return handler(options)
}
