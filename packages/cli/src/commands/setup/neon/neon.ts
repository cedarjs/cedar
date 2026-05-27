import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'neon'
export const description =
  'Provision a Neon Postgres database and configure your project'

export function builder(yargs: Argv) {
  return yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing DATABASE_URL in .env',
      type: 'boolean',
    })
    .option('migrations', {
      description:
        'Run Prisma migrations after setup. Omit to be prompted. Use --no-migrations to skip.',
      type: 'boolean',
    })
    .option('verbose', {
      alias: 'v',
      default: false,
      description: 'Show full output from migration commands (stderr → stdout)',
      type: 'boolean',
    })
}

export interface Args {
  force: boolean
  migrations?: boolean
  verbose: boolean
}

export async function handler({ force, migrations, verbose }: Args) {
  recordTelemetryAttributes({
    command: 'setup neon',
    force,
  })

  const { handler } = await import('./neonHandler.js')
  return handler({ force, migrations, verbose })
}
