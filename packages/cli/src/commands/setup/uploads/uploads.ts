import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'

export const command = 'uploads'

export const description =
  'Set up file uploads and storage: storage targets, upload profiles, the upload routes, and the GraphQL API'

export const TARGET_CHOICES = ['fs', 'db', 's3'] as const

export type TargetChoice = (typeof TARGET_CHOICES)[number]

export const builder = (yargs: Argv) => {
  return yargs
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
  targets: string[]
  force: boolean
}) => {
  // yargs validates `choices`, so every entry is a TargetChoice; the
  // predicate narrows the type without a cast
  const targets = options.targets.filter((t): t is TargetChoice =>
    (TARGET_CHOICES as readonly string[]).includes(t),
  )

  recordTelemetryAttributes({
    command: 'setup uploads',
    targets: targets.join(','),
    force: options.force,
  })

  const { handler } = await import('./uploadsHandler.js')
  return handler({ targets, force: options.force })
}
