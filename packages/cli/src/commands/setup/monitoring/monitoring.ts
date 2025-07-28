import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import * as sentryCommand from './sentry/sentry.js'

export const command = 'monitoring <provider>'
export const description = 'Set up monitoring in your Redwood app'
export function builder(yargs: Argv) {
  return yargs
    .command(sentryCommand)
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-graphql',
      )}`,
    )
}
