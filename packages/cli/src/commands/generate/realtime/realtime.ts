import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'realtime <name>'

export const description =
  'Generate a subscription or live query used with RedwoodJS Realtime'

export function builder(yargs: Argv) {
  yargs
    .positional('name', {
      type: 'string',
      description:
        'Name of the realtime event to setup. This should be a type or model name like: Widget, Sprocket, etc.',
      demandOption: true,
    })
    .option('type', {
      alias: 't',
      type: 'string',
      choices: ['liveQuery', 'subscription'] as const,
      description: 'Type of realtime event to setup',
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

  return yargs
}

interface RealtimeOptions {
  name: string
  type?: 'liveQuery' | 'subscription'
  force: boolean
  verbose: boolean
}

export async function handler(options: RealtimeOptions) {
  recordTelemetryAttributes({
    command: 'generate realtime',
    type: options.type,
    force: options.force,
    verbose: options.verbose,
  })

  // @ts-expect-error - no types for JS files
  const { handler } = await import('./realtimeHandler.js')
  return handler(options)
}
