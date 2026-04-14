import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - No types for JS files
import { getEpilogue } from '../util.js'

export const command = 'setup-live-queries'

export const description =
  'Setup live query invalidation with Postgres notifications'

export function builder(yargs: Argv) {
  return yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
    .option('verbose', {
      alias: 'v',
      default: false,
      description: 'Print more logs',
      type: 'boolean',
    })
    .epilogue(getEpilogue(command, description))
}

export async function handler(options: { force: boolean; verbose: boolean }) {
  recordTelemetryAttributes({
    command: `experimental ${command}`,
    force: options.force,
    verbose: options.verbose,
  })

  const { handler } = await import('./liveQueriesHandler.js')
  return handler(options)
}
