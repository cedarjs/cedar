import type { Argv } from 'yargs'

export const command = 'universal-deploy'

export const description = 'Setup Universal Deploy'

export const builder = (yargs: Argv) => {
  return yargs.option('force', {
    alias: 'f',
    default: false,
    description: 'Overwrite existing configuration',
    type: 'boolean',
  })
}

export interface Args {
  force: boolean
}

export async function handler({ force }: Args) {
  const { handler } = await import('./universalDeployHandler.js')

  return handler({ force })
}
