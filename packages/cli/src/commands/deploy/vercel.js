import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { deployBuilder } from './helpers/deployBuilder.js'

export const command = 'vercel [...commands]'
export const description = 'Build command for Vercel deploy'

export const builder = (yargs) => deployBuilder(yargs)

export async function handler(yargs) {
  recordTelemetryAttributes({
    command: 'deploy vercel',
    build: yargs.build,
    prisma: yargs.prisma,
    dataMigrate: yargs.dataMigrate,
  })

  const { deployHandler } = await import('./helpers/deployHandler.js')

  return deployHandler(yargs)
}
