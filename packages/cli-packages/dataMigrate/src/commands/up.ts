import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { getPaths, projectIsEsm } from '@cedarjs/project-config'

import type { DataMigrateUpOptions } from '../types'

export const command = 'up'
export const description =
  'Run any outstanding Data Migrations against the database'

export function builder(yargs: Argv): Argv {
  return yargs
    .option('import-db-client-from-dist', {
      type: 'boolean',
      alias: ['db-from-dist'],
      description: 'Import the db client from dist',
      default: false,
    })
    .option('dist-path', {
      type: 'string',
      alias: 'd',
      description: 'Path to the api dist directory',
      default: getPaths().api.dist,
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#datamigrate-up',
      )}`,
    )
}

export async function handler(options: DataMigrateUpOptions): Promise<void> {
  if (projectIsEsm()) {
    const { handler: dataMigrateUpHandler } = await import('./upHandlerEsm.js')
    await dataMigrateUpHandler(options)
  } else {
    const { handler: dataMigrateUpHandler } = await import('./upHandler.js')
    await dataMigrateUpHandler(options)
  }
}
