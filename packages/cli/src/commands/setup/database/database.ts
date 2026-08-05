import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import * as setupDatabasePostgres from './postgres.js'

export const command = 'database <command>'
export const description = "Switch your project's database"

export const builder = (yargs: Argv) =>
  yargs
    .command(setupDatabasePostgres)
    .demandCommand()
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup',
      )}`,
    )
