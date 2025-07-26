import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { ensurePosixPath } from '@cedarjs/project-config'
import { errorTelemetry, timedTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../lib/index.js'
import * as project from '../lib/project.js'

export const handler = async ({
  filter: filterParams = [],
  dbPush = true,
  ...others
}) => {
  recordTelemetryAttributes({
    command: 'test',
    dbPush,
  })
  let watch = true
  const rwjsPaths = getPaths()
  const forwardJestFlags = Object.keys(others).flatMap((flagName) => {
    if (['db-push', 'loadEnvFiles', '$0', '_'].includes(flagName)) {
      // filter out flags meant for the rw test command only
      return []
    } else {
      // and forward on the other flags
      const flag = flagName.length > 1 ? `--${flagName}` : `-${flagName}`
      const flagValue = others[flagName]

      if (flagName === 'watch') {
        watch = flagValue === true
      } else if (flagName === 'run' && flagValue) {
        watch = false
      }

      if (Array.isArray(flagValue)) {
        // jest does not collapse flags e.g. --coverageReporters=html --coverageReporters=text
        // so we pass it on. Yargs collapses these flags into an array of values
        return flagValue.flatMap((val) => [flag, val])
      } else {
        return [flag, flagValue]
      }
    }
  })

  // Only the side params
  const sides = filterParams.filter((filterString) =>
    project.sides().includes(filterString),
  )

  // All the other params, apart from sides
  const jestFilterArgs = [
    ...filterParams.filter(
      (filterString) => !project.sides().includes(filterString),
    ),
  ]

  const vitestArgs = [
    ...jestFilterArgs,
    ...forwardJestFlags,
    '--passWithNoTests',
  ].filter((flagOrValue) => flagOrValue !== null) // Filter out nulls, not booleans because user may have passed a --something false flag

  if (process.env.CI) {
    // Force run mode in CI
    vitestArgs.push('--run')
  }

  // if no sides declared with yargs, default to all sides
  if (!sides.length) {
    project.sides().forEach((side) => sides.push(side))
  }

  sides.forEach((side) => vitestArgs.push('--project', side))

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

    // **NOTE** There is no official way to run Jest programmatically,
    // so we're running it via execa, since `jest.run()` is a bit unstable.
    // https://github.com/facebook/jest/issues/5048
    // TODO: Run vitest programmatically. See https://vitest.dev/advanced/api/
    const runCommand = async () => {
      await execa('yarn vitest', vitestArgs, {
        cwd: rwjsPaths.base,
        shell: true,
        stdio: 'inherit',
        env: { DATABASE_URL },
      })
    }

    if (watch) {
      await runCommand()
    } else {
      await timedTelemetry(process.argv, { type: 'test' }, async () => {
        await runCommand()
      })
    }
  } catch (e) {
    // Errors already shown from execa inherited stderr
    errorTelemetry(process.argv, e.message)
    process.exit(e?.exitCode || 1)
  }
}
