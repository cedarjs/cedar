import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'docker'

export const description = 'Setup the default Redwood Dockerfile'

export function builder(yargs: Argv) {
  yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
}

export async function handler(options: { force: boolean; verbose?: boolean }) {
  recordTelemetryAttributes({
    command: 'setup docker',
    force: options.force,
    verbose: options.verbose,
  })

  // @ts-expect-error - no types for JS files
  const { handler } = await import('./dockerHandler.js')
  return handler(options)
}
