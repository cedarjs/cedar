import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'realtime'

export const description = 'Setup RedwoodJS Realtime'

export function builder(yargs: Argv) {
  yargs
    .option('includeExamples', {
      alias: ['e', 'examples'],
      default: undefined,
      description:
        'Include examples of how to implement liveQueries and subscriptions',
      type: 'boolean',
    })
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
}

export async function handler(options: {
  includeExamples: boolean | undefined
  force: boolean
  verbose: boolean
}) {
  recordTelemetryAttributes({
    command: 'setup realtime',
    includeExamples: options.includeExamples,
    force: options.force,
    verbose: options.verbose,
  })

  // @ts-expect-error - no types for JS files
  const { handler } = await import('./realtimeHandler.js')
  return handler(options)
}
