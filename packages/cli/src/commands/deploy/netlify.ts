import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { deployBuilder } from './helpers/deployBuilder.js'

export const command = 'netlify [...commands]'
export const description = 'Build command for Netlify deploy'

export const builder = (yargs: { option: Function; epilogue: Function }) =>
  deployBuilder(yargs)

export async function handler(yargs: {
  build: boolean
  prisma: boolean
  dataMigrate: boolean
}): Promise<void> {
  recordTelemetryAttributes({
    command: 'deploy netlify',
    build: yargs.build,
    prisma: yargs.prisma,
    dataMigrate: yargs.dataMigrate,
  })

  const { deployHandler } = await import('./helpers/deployHandler.js')

  return deployHandler(yargs)
}
