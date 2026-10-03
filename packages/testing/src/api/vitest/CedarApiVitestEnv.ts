import path from 'node:path'

import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getConfig, getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

import {
  checkTestDatabaseIdentity,
  checkTestDatabaseUrlMatchesProvider,
  redactDatabaseUrl,
} from '../checkTestDatabase.js'

/**
 * The most relevant part of a failing command's output is usually at the end
 * (Prisma prints its error last), so long output is trimmed from the start.
 */
const MAX_ERROR_OUTPUT_LENGTH = 4000

function joinOutput(stdout: string | undefined, stderr: string | undefined) {
  return [stdout, stderr]
    .map((stream) => stream?.trim())
    .filter((stream): stream is string => Boolean(stream))
    .join('\n')
}

/**
 * Builds the message for the error thrown when the test database couldn't be
 * reset, so the reason is the first thing the developer sees in Vitest's
 * error report.
 */
function formatDbResetError(
  command: string,
  exitCode: number | undefined,
  output: string,
) {
  const exitInfo =
    typeof exitCode === 'number' ? ` (exit code ${exitCode})` : ''
  const lines = [
    `Failed to reset the test database${exitInfo}.`,
    `Command: ${command}`,
  ]

  if (output) {
    const trimmedOutput =
      output.length > MAX_ERROR_OUTPUT_LENGTH
        ? '...\n' + output.slice(-MAX_ERROR_OUTPUT_LENGTH)
        : output
    lines.push('', 'Output:', trimmedOutput)
  }

  return lines.join('\n')
}

const CedarApiVitestEnvironment: Environment = {
  name: 'cedar-api',
  viteEnvironment: 'ssr',

  async setup() {
    if (process.env.SKIP_DB_PUSH === '1') {
      return {
        teardown() {},
      }
    }

    const cedarPaths = getPaths()

    // The app's real DATABASE_URL, captured before it's overwritten below.
    // `cedar test` (testHandler.ts) already overwrites its child process's
    // DATABASE_URL before this environment even starts, so it forwards the
    // original value separately as CEDAR_APP_DATABASE_URL — always, even as
    // '' when there wasn't one — so its presence marks "this ran through
    // `cedar test`" and its value can be trusted exclusively. Without that
    // distinction, a run through `cedar test` with no DATABASE_URL of its
    // own would fall back here to the already-overwritten DATABASE_URL
    // (i.e. the test database itself), which would then look identical to
    // itself and trip the same-database check below. A run that bypasses
    // `cedar test` entirely (e.g. `vitest` invoked directly) never sets
    // CEDAR_APP_DATABASE_URL, so DATABASE_URL is still the untouched real
    // value at this point and is safe to use.
    const mainDatabaseUrl =
      'CEDAR_APP_DATABASE_URL' in process.env
        ? process.env.CEDAR_APP_DATABASE_URL
        : process.env.DATABASE_URL

    const defaultDb = `file:${path.join(cedarPaths.generated.base, 'test.db')}`
    const usedFallback = !process.env.TEST_DATABASE_URL

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

    await checkTestDatabaseUrlMatchesProvider(
      process.env.DATABASE_URL,
      usedFallback,
    )

    const testConfig = getConfig().test
    checkTestDatabaseIdentity(
      process.env.DATABASE_URL,
      mainDatabaseUrl,
      usedFallback,
    )

    console.log(
      `Setting up test database: ${redactDatabaseUrl(process.env.DATABASE_URL)}`,
    )

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const pm = getPackageManager()
    // This kind of logic should not live here. We have it in cli-helpers, but
    // it also doesn't make sense to have the testing package depend on
    // cli-helpers I don't think. So I duplicate the logic here.
    // see `runTransitiveBinSync` in packages/cli-helpers/src/packageManager/exec.ts
    const pmExec = pm === 'pnpm' ? pm : 'npx'

    const env = { ...process.env }
    // Cedar only fills this in when the human/agent running the command
    // hasn't already set it themselves, and only once the target above has
    // been confirmed a dedicated test database — never the app's real
    // DATABASE_URL. See https://github.com/cedarjs/cedar/issues/2622.
    if (
      testConfig.autoConsentToDbReset &&
      !('PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION' in env)
    ) {
      env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION =
        "Cedar auto-consent: cedar.toml's [test] autoConsentToDbReset is " +
        "true, and the reset target passed Cedar's test-database identity guard."
    }

    // Output is captured rather than inherited: this runs inside a Vitest
    // pool worker, where inherited output doesn't reliably reach the
    // developer's terminal. The thrown error, however, is always reported, so
    // on failure the captured output is included in its message.
    const result = execa.sync(pmExec, ['cedar', ...command], {
      cwd: cedarPaths.api.base,
      env,
      reject: false,
    })

    if (result.failed) {
      const output = joinOutput(result.stdout, result.stderr)

      if (output) {
        console.error(output)
      }

      throw new Error(
        formatDbResetError(
          result.command,
          result.exitCode,
          output || (result instanceof Error ? result.message : ''),
        ),
      )
    }

    if (result.stdout) {
      console.log(result.stdout)
    }

    if (result.stderr) {
      console.error(result.stderr)
    }

    return {
      teardown() {},
    }
  },
}

export default CedarApiVitestEnvironment
