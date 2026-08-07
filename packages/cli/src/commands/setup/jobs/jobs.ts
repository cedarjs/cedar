import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'jobs'
export const description =
  'Sets up the config file and parent directory for background jobs'

export const builder = (yargs: Argv) => {
  yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing files',
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#setup-jobs',
      )}`,
    )
}

export const handler = async (options: { force: boolean }) => {
  recordTelemetryAttributes({
    command: 'setup jobs',
    force: options.force,
  })
  const { handler } = await import('./jobsHandler.js')
  return handler(options)
}
