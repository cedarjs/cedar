import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'cedar-pg'
export const description =
  'Configure worktree-isolated local Postgres via cedar-pg + autopg'

export function builder(yargs: Argv) {
  return yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing schema / env settings',
      type: 'boolean',
    })
    .option('path', {
      description:
        'Path to a local cedar-pg checkout (default: ../cedar-pg next to the app, or CEDAR_PG_PATH)',
      type: 'string',
    })
}

export interface Args {
  force: boolean
  path?: string
}

export async function handler(args: Args) {
  recordTelemetryAttributes({
    command: 'setup cedar-pg',
    force: args.force,
  })

  const { handler } = await import('./cedarPgHandler.js')
  return handler(args)
}
