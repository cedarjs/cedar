import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'postgres'
export const description =
  'Switch your project from SQLite to PostgreSQL (schema, dependencies, and database adapter)'

export function builder(yargs: Argv) {
  return yargs
}

export async function handler() {
  recordTelemetryAttributes({
    command: 'setup database postgres',
  })

  const { handler } = await import('./postgresHandler.js')
  return handler()
}
