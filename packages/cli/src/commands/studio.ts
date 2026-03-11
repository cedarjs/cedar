import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'studio'
export const description = 'Run the CedarJS development studio'
type StudioOptions = {
  open?: boolean
}

export function builder(yargs: Argv) {
  yargs.option('open', {
    default: true,
    description: 'Open the studio in your browser',
  })
}

export async function handler(options: StudioOptions) {
  recordTelemetryAttributes({
    command: 'studio',
    open: options.open,
  })

  const { handler } = await import('./studioHandler.js')
  return handler(options)
}
