import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - no types for JS files
import { deployBuilder } from './helpers/deployBuilder.js'

export const command = 'netlify [...commands]'
export const description = 'Build command for Netlify deploy'

export const builder = (yargs: Argv) => deployBuilder(yargs)

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

  // @ts-expect-error - no types for JS files
  const { deployHandler } = await import('./helpers/deployHandler.js')

  return deployHandler(yargs)
}
