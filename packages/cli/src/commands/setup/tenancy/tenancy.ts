import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'

export const command = 'tenancy'

export const description =
  'Set up multi-tenancy: organizations, memberships and tenant-scoped database access'

export const builder = (yargs: Argv) => {
  yargs
    .option('tenant-field', {
      default: 'organizationId',
      description: 'Column name used to scope tenant-owned models',
      type: 'string',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
}

export const handler = async (options: {
  tenantField: string
  force: boolean
}) => {
  recordTelemetryAttributes({
    command: 'setup tenancy',
    tenantField: options.tenantField,
    force: options.force,
  })

  const { handler } = await import('./tenancyHandler.js')
  return handler(options)
}
