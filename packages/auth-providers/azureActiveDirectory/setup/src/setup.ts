import type { Argv } from 'yargs'

import { standardAuthBuilder } from '@cedarjs/cli-helpers'

export const command = 'azure-active-directory'
export const description = 'Set up auth for Azure Active Directory'

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
