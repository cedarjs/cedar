import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import {
  getPackageManager,
  runBin,
  runPackageManagerCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { ensurePosixPath } from '@cedarjs/project-config'
import { errorTelemetry, timedTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'
// @ts-expect-error - Types not available for JS files
import * as project from '../../lib/project.js'

import { warnIfNonStandardDatasourceUrl } from './datasourceWarning.js'

type TestEsmHandlerArgs = Record<string, unknown> & {
  filter?: string[]
  dbPush?: boolean
  force?: boolean
}

function hasStringMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    value.message === 'string'
  )
}

function getExitCode(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('exitCode' in value) ||
    typeof value.exitCode !== 'number'
  ) {
    return undefined
  }

  return value.exitCode
}

export const handler = async ({
  filter: filterParams = [],
  dbPush = true,
  force = false,
  ...others
}: TestEsmHandlerArgs) => {
  recordTelemetryAttributes({
    command: 'test',
    dbPush,
  })

  let watch = true
  const rwjsPaths = getPaths()

  const forwardVitestFlags = Object.keys(others).flatMap((flagName) => {
    if (['db-push', 'force', 'loadEnvFiles', '$0', '_'].includes(flagName)) {
      // filter out flags meant for the rw test command only
      return []
    }

    // and forward on the other flags
    const flag = flagName.length > 1 ? `--${flagName}` : `-${flagName}`
    const flagValue = others[flagName]

    if (flagName === 'watch') {
      watch = flagValue === true
    } else if (flagName === 'run' && flagValue) {
      watch = false
    }

    if (Array.isArray(flagValue)) {
      // vitest does not collapse flags e.g. --coverageReporters=html --coverageReporters=text
      // so we pass it on. Yargs collapses these flags into an array of values
      return flagValue.flatMap((val) => [flag, val])
    }

    return [flag, flagValue]
  })

  // Only the side params
  const sides = filterParams.filter((filterString) =>
    project.workspaces().includes(filterString),
  )

  // All the other params, apart from sides
  const vitestFilterArgs = [
    ...filterParams.filter(
      (filterString) => !project.workspaces().includes(filterString),
    ),
  ]

  const vitestArgs = [
    ...vitestFilterArgs,
    ...forwardVitestFlags,
    '--passWithNoTests',
  ].filter((flagOrValue) => flagOrValue !== null) // Filter out nulls, not booleans because user may have passed a --something false flag

  if (process.env.CI) {
    // Force run mode in CI
    vitestArgs.push('--run')
  }

  // When a custom --config is provided the config manages its own project
  // setup, so adding --project flags would fail with "No projects matched".
  if (!others['config']) {
    // if no sides declared with yargs, default to all sides
    if (!sides.length) {
      project.workspaces().forEach((side: string) => sides.push(side))
    }

    sides.forEach((side) => vitestArgs.push('--project', side))
  }

  try {
    const cacheDirDb = `file:${ensurePosixPath(
      rwjsPaths.generated.base,
    )}/test.db`
    const DATABASE_URL = process.env.TEST_DATABASE_URL || cacheDirDb

    if (sides.includes('api') && !dbPush) {
      process.env.SKIP_DB_PUSH = '1'
    }

    if (sides.includes('api')) {
      await warnIfNonStandardDatasourceUrl({ force })
    }

    // TODO: Run vitest programmatically. See https://vitest.dev/advanced/api/
    const runCommand = async () => {
      await runPackageManagerCommand(
        runBin('vitest', vitestArgs, getPackageManager()),
        {
          cwd: rwjsPaths.base,
          stdio: 'inherit',
          env: { ...process.env, DATABASE_URL },
        },
      )
    }

    if (watch) {
      await runCommand()
    } else {
      await timedTelemetry(process.argv, { type: 'test' }, async () => {
        await runCommand()
      })
    }
  } catch (error: unknown) {
    // Errors already shown from execa inherited stderr
    const message = hasStringMessage(error)
      ? error.message
      : 'Test command failed'
    errorTelemetry(process.argv, message)
    process.exit(getExitCode(error) ?? 1)
  }
}
