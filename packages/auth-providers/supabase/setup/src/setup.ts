import type { Argv } from 'yargs'

import { standardAuthBuilder } from '@cedarjs/cli-helpers'

export const command = 'supabase'
export const description = 'Set up auth for for Supabase'

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
