import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'i18n'
export const description = 'Set up i18n'
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
    command: 'setup i18n',
    force: options.force,
  })

  const { handler } = await import('./i18nHandler.js')
  return handler(options)
}
