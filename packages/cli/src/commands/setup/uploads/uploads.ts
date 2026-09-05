import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'

export const command = 'uploads'

export const description =
  'Set up file uploads and storage: storage targets, upload profiles, the upload routes, and the GraphQL API'

export const TARGET_CHOICES = ['fs', 'db', 's3'] as const

export type TargetChoice = (typeof TARGET_CHOICES)[number]

export const builder = (yargs: Argv) => {
  yargs
    .option('targets', {
      choices: TARGET_CHOICES,
      default: ['fs', 'db'],
      description:
        'Storage targets to configure: fs (local filesystem), db (inline in the database), s3 (direct-to-S3 presigned uploads)',
      type: 'array',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
}

export const handler = async (options: {
  targets: TargetChoice[]
  force: boolean
}) => {
  recordTelemetryAttributes({
    command: 'setup uploads',
    targets: options.targets.join(','),
    force: options.force,
  })

  const { handler } = await import('./uploadsHandler.js')
  return handler(options)
}
