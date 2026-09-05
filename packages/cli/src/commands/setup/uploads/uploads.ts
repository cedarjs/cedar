import prompts from 'prompts'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { requireTTYOrExit } from '@cedarjs/cli-helpers/tty'

export const command = 'uploads'

export const description =
  'Set up file uploads and storage: storage targets, upload profiles, the upload routes, and the GraphQL API'

export const TARGET_CHOICES = ['fs', 'db', 's3'] as const

export type TargetChoice = (typeof TARGET_CHOICES)[number]

const TARGET_DESCRIPTIONS: Record<TargetChoice, string> = {
  fs: 'Local filesystem, uploaded through the api server (development, single-server deploys)',
  db: 'Inline in the database, for small files like avatars and thumbnails',
  s3: 'S3 or S3-compatible storage, uploaded straight from the browser with presigned URLs',
}

export const builder = (yargs: Argv) => {
  return yargs
    .option('targets', {
      choices: TARGET_CHOICES,
      description:
        'Storage targets to configure: fs (local filesystem), db (inline in the database), s3 (direct-to-S3 presigned uploads). Prompts when omitted.',
      type: 'array',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
}

/**
 * Narrows and deduplicates the raw option values. yargs validates
 * `choices`, so every entry is a TargetChoice; the predicate narrows the
 * type without a cast.
 */
export function toTargetChoices(values: string[]): TargetChoice[] {
  const choices: readonly string[] = TARGET_CHOICES

  return [...new Set(values)].filter((t): t is TargetChoice =>
    choices.includes(t),
  )
}

async function promptForTargets(): Promise<TargetChoice[]> {
  requireTTYOrExit('--targets')

  const response = await prompts({
    type: 'multiselect',
    name: 'targets',
    message: 'Which storage targets do you want to configure?',
    instructions: false,
    hint: 'Space to toggle, enter to confirm',
    min: 1,
    choices: TARGET_CHOICES.map((value) => ({
      title: value,
      description: TARGET_DESCRIPTIONS[value],
      value,
      selected: value !== 's3',
    })),
  })

  // prompts returns undefined for the value if the user ctrl-c's
  if (response.targets === undefined) {
    process.exit(0)
  }

  return toTargetChoices(response.targets)
}

export const handler = async (options: {
  targets?: string[]
  force: boolean
}) => {
  // `--targets` with no values yields an empty array, which is as good as
  // omitted
  const targets = options.targets?.length
    ? toTargetChoices(options.targets)
    : await promptForTargets()

  recordTelemetryAttributes({
    command: 'setup uploads',
    targets: targets.join(','),
    force: options.force,
  })

  const { handler } = await import('./uploadsHandler.js')
  return handler({ targets, force: options.force })
}
