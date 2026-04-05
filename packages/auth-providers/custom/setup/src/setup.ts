import type { Argv } from 'yargs'

import { standardAuthBuilder } from '@cedarjs/cli-helpers'

export const command = 'custom'
export const description = 'Generate a custom auth configuration'

export function builder(yargs: Argv) {
  return standardAuthBuilder(yargs)
}

export interface Args {
  force: boolean
}

export async function handler(options: Args) {
  const { handler } = await import('./setupHandler.js')
  return handler(options)
}
