import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import type { HandlerArgs } from './flightcontrolHandler.js'

export const command = 'flightcontrol <side>'
export const alias = 'fc'
export const description =
  'Build, Migrate, and Serve commands for Flightcontrol deploy'

export const builder = (yargs: Argv) => {
  yargs
    .positional('side', {
      choices: ['api', 'web'],
      description: 'Side to deploy',
      type: 'string',
    })
    .option('prisma', {
      description: 'Apply database migrations',
      type: 'boolean',
      default: true,
    })
    .option('serve', {
      description: 'Run server for api in production',
      type: 'boolean',
      default: false,
    })
    .option('data-migrate', {
      description: 'Apply data migrations',
      type: 'boolean',
      default: true,
      alias: 'dm',
    })
    .epilogue(
      `For more commands, options, and examples, see ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#deploy',
      )}`,
    )

  return yargs
}

export async function handler(yargs: HandlerArgs) {
  const { handler: importedHandler } = await import('./flightcontrolHandler.js')

  return importedHandler(yargs)
}
