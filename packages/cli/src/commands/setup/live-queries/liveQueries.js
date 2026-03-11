import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'live-queries'

export const description =
  'Setup live query invalidation with Postgres notifications'

export function builder(yargs) {
  yargs
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

export async function handler(options) {
  recordTelemetryAttributes({
    command: 'setup live-queries',
    force: options.force,
    verbose: options.verbose,
  })

  const { handler } = await import('./liveQueriesHandler.js')
  return handler(options)
}
