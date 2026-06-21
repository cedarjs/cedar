import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'server-file'

export const description = 'Setup the server file'

export function builder(yargs: Argv) {
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

export async function handler(options: { force: boolean; verbose: boolean }) {
  recordTelemetryAttributes({
    command: 'setup server-file',
    force: options.force,
    verbose: options.verbose,
  })
  const { handler } = await import('./serverFileHandler.js')
  return handler(options)
}
