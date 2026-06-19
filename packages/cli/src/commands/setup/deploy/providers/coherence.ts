import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'coherence'

export const description = 'Setup Coherence deploy'

export function builder(yargs: Argv) {
  yargs.option('force', {
    description: 'Overwrite existing configuration',
    type: 'boolean',
    default: false,
  })
}

export async function handler(options: { force: boolean }) {
  recordTelemetryAttributes({
    command: 'setup deploy coherence',
    force: options.force,
  })
  // @ts-expect-error - no types for JS file yet
  const { handler } = await import('./coherenceHandler.js')
  return handler(options)
}
