import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'neon'
export const description =
  'Provision a Neon Postgres database and configure your project'

export function builder(yargs: Argv) {
  return yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing DATABASE_URL in .env',
    type: 'boolean',
  })
}

export interface Args {
  force: boolean
}

export async function handler({ force }: Args) {
  recordTelemetryAttributes({
    command: 'setup neon',
    force,
  })

  const { handler } = await import('./neonHandler.js')
  return handler({ force })
}
