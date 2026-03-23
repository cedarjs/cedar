import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import {
  getPackageManager,
  runBin,
  runPackageManagerCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { ensurePosixPath } from '@cedarjs/project-config'
import { errorTelemetry, timedTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'
// @ts-expect-error - Types not available for JS files
import * as project from '../../lib/project.js'

import { warnIfNonStandardDatasourceUrl } from './datasourceWarning.js'

type TestHandlerArgs = Record<string, unknown> & {
  filter?: string[]
  watch?: boolean
  collectCoverage?: boolean
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

// https://github.com/facebook/create-react-app/blob/cbad256a4aacfc3084be7ccf91aad87899c63564/packages/react-scripts/scripts/test.js#L39
function isInGitRepository() {
  try {
    execa.commandSync('git rev-parse --is-inside-work-tree')
    return true
  } catch {
    return false
  }
}

function isInMercurialRepository() {
  try {
    execa.commandSync('hg --cwd . root')
    return true
  } catch {
    return false
  }
}

function isJestConfigFile(sides: string[]) {
  for (const side of sides) {
    try {
      const jestConfigExists =
        fs.existsSync(path.join(side, 'jest.config.js')) ||
        fs.existsSync(path.join(side, 'jest.config.ts'))

      if (!jestConfigExists) {
        console.error(
          c.error(
            `\nError: Missing Jest config file ${side}/jest.config.js` +
              '\nTo add this file, run `npx @cedarjs/codemods update-jest-config`\n',
          ),
        )
        throw new Error(`Error: Jest config file not found in ${side} side`)
      }
    } catch (error: unknown) {
      const message = hasStringMessage(error)
        ? error.message
        : `Error: Jest config file not found in ${side} side`

      errorTelemetry(process.argv, message)
      process.exit(getExitCode(error) ?? 1)
    }
  }
}

export const handler = async ({
  filter: filterParams = [],
  watch = true,
  collectCoverage = false,
  dbPush = true,
  force = false,
  ...others
}: TestHandlerArgs) => {
  recordTelemetryAttributes({
    command: 'test',
    watch,
    collectCoverage,
    dbPush,
  })

  const rwjsPaths = getPaths()
  const forwardJestFlags = Object.keys(others).flatMap((flagName) => {
    if (
      [
        'collect-coverage',
        'db-push',
        'force',
        'loadEnvFiles',
        'watch',
        '$0',
        '_',
      ].includes(flagName)
    ) {
      // filter out flags meant for the rw test command only
      return []
    }

    // and forward on the other flags
    const flag = flagName.length > 1 ? `--${flagName}` : `-${flagName}`
    const flagValue = others[flagName]

    if (Array.isArray(flagValue)) {
      // jest does not collapse flags e.g. --coverageReporters=html --coverageReporters=text
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
  const jestFilterArgs = [
    ...filterParams.filter(
      (filterString) => !project.workspaces().includes(filterString),
    ),
  ]

  const jestArgs = [
    ...jestFilterArgs,
    ...forwardJestFlags,
    collectCoverage ? '--collectCoverage' : null,
    '--passWithNoTests',
  ].filter((flagOrValue) => flagOrValue !== null) // Filter out nulls, not booleans because user may have passed a --something false flag

  // If the user wants to watch, set the proper watch flag based on what kind of repo this is
  // because of https://github.com/facebook/create-react-app/issues/5210
  if (watch && !process.env.CI && !collectCoverage) {
    const hasSourceControl = isInGitRepository() || isInMercurialRepository()
    jestArgs.push(hasSourceControl ? '--watch' : '--watchAll')
  }

  // if no sides declared with yargs, default to all sides
  if (!sides.length) {
    project.workspaces().forEach((side: string) => sides.push(side))
  }

  if (sides.length > 0) {
    jestArgs.push('--projects', ...sides)
  }

  // checking if Jest config files exists in each of the sides
  isJestConfigFile(sides)

  try {
    const cacheDirDb = `file:${ensurePosixPath(
      rwjsPaths.generated.base,
    )}/test.db`
    const DATABASE_URL = process.env.TEST_DATABASE_URL || cacheDirDb

    if (sides.includes('api') && !dbPush) {
      // @NOTE
      // DB push code now lives in packages/testing/config/jest/api/jest-preset.js
      process.env.SKIP_DB_PUSH = '1'
    }

    if (sides.includes('api')) {
      await warnIfNonStandardDatasourceUrl({ force })
    }

    // **NOTE** There is no official way to run Jest programmatically,
    // so we're running it via execa, since `jest.run()` is a bit unstable.
    // https://github.com/facebook/jest/issues/5048
    const runCommand = async () => {
      await runPackageManagerCommand(
        runBin('jest', jestArgs, getPackageManager()),
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
