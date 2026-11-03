import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'

export const command = 'permissions'

export const description =
  'Set up permissions: a map of what each role may do, checked with @requirePermission and hasPermission'

export const builder = (yargs: Argv) => {
  yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
}

export const handler = async (options: { force: boolean }) => {
  recordTelemetryAttributes({
    command: 'setup permissions',
    force: options.force,
  })

  const { handler } = await import('./permissionsHandler.js')
  return handler(options)
}
