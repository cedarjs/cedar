import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export interface RealtimeOptions {
  name: string
  type?: 'liveQuery' | 'subscription'
  force: boolean
  verbose: boolean
  silent?: boolean
}

export const command = 'realtime <name>'

export const description =
  'Generate a subscription or live query used with RedwoodJS Realtime'

export function builder(yargs: Argv): Argv<RealtimeOptions> {
  return yargs
    .positional('name', {
      type: 'string',
      description:
        'Name of the realtime event to setup. This should be a type or model name like: Widget, Sprocket, etc.',
      demandOption: true,
    })
    .option('type', {
      alias: 't',
      type: 'string' as const,
      choices: ['liveQuery', 'subscription'] as const,
      description: 'Type of realtime event to setup',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean' as const,
    })
    .option('verbose', {
      alias: 'v',
      default: false,
      description: 'Print more logs',
      type: 'boolean' as const,
    })
}

export async function handler(options: RealtimeOptions) {
  recordTelemetryAttributes({
    command: 'generate realtime',
    type: options.type,
    force: options.force,
    verbose: options.verbose,
  })

  const { handler } = await import('./realtimeHandler.js')
  return handler(options)
}
