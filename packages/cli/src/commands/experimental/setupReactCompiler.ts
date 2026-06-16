import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { getEpilogue } from './util.js'

export const command = 'setup-react-compiler'

export const description = 'Enable the experimental React Compiler'

export const EXPERIMENTAL_TOPIC_ID = '7128'

export const builder = (yargs: Argv) => {
  yargs
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
    .epilogue(getEpilogue(command, description, EXPERIMENTAL_TOPIC_ID, true))
}

export const handler = async (options: { force: boolean }) => {
  recordTelemetryAttributes({
    command: ['experimental', command].join(' '),
    force: options.force,
  })
  const { handler } = await import('./setupReactCompilerHandler.js')
  return handler(options)
}
