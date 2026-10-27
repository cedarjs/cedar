import fs from 'node:fs'
import path from 'node:path'

import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { recordTelemetryAttributes } from '@cedarjs/cli-helpers/telemetry'
import { getPaths } from '@cedarjs/project-config'

export const command = 'lint [paths..]'
export const description = 'Lint your files'
export const builder = (yargs: Argv) => {
  yargs
    .positional('paths', {
      description:
        'Specify file(s) or directory(ies) to lint relative to project root',
      type: 'string',
      array: true,
    })
    .option('fix', {
      default: false,
      description: 'Try to fix errors',
      type: 'boolean',
    })
    .option('format', {
      default: 'stylish',
      description: 'Use a specific output format',
      type: 'string',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#lint',
      )}`,
    )
}

interface LintOptions {
  paths?: string[]
  fix?: boolean
  format?: string
}

export const handler = async ({
  paths = [],
  fix = false,
  format = 'stylish',
}: LintOptions) => {
  recordTelemetryAttributes({ command: 'lint', fix, format })

  try {
    await generateMissingGraphQLSchema()

    const sbPath = getPaths().web.storybook
    const eslintArgs: (string | false)[] = [
      fix && '--fix',
      '--format',
      format,
      ...paths,
    ]

    if (paths.length === 0) {
      eslintArgs.push(
        fs.existsSync(getPaths().web.src) && 'web/src',
        fs.existsSync(getPaths().web.config) && 'web/config',
        fs.existsSync(sbPath) && 'web/.storybook',
        fs.existsSync(getPaths().scripts) && 'scripts',
        fs.existsSync(getPaths().api.src) && 'api/src',
      )
    }

    const filteredEslintArgs = eslintArgs.filter((arg): arg is string =>
      Boolean(arg),
    )

    const result = await runBin('eslint', filteredEslintArgs, {
      cwd: getPaths().base,
      stdio: 'inherit',
    })

    process.exitCode = result.exitCode
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'exitCode' in error) {
      process.exitCode = typeof error.exitCode === 'number' ? error.exitCode : 1
      return
    }

    process.exitCode = 1
  }
}

/**
 * The GraphQL rules in @cedarjs/eslint-config read the generated schema, and
 * are left out while it doesn't exist (as on a fresh clone, or in CI before
 * types are generated). Generate it here, so `cedar lint` always runs them.
 * Only the schema: it's read from the SDL files, without the slower type
 * generation
 */
async function generateMissingGraphQLSchema() {
  const paths = getPaths()

  if (
    fs.existsSync(paths.generated.schema) ||
    !fs.existsSync(paths.api.graphql) ||
    !fs.existsSync(paths.web.src)
  ) {
    return
  }

  const { generateGraphQLSchema } =
    await import('@cedarjs/internal/dist/generate/graphqlSchema')

  fs.mkdirSync(path.dirname(paths.generated.schema), { recursive: true })
  const { errors } = await generateGraphQLSchema()

  if (errors.length > 0) {
    console.warn(
      'Could not generate the GraphQL schema, so the GraphQL documents in ' +
        'web/src are not linted against it:',
    )

    for (const { message } of errors) {
      console.warn(message)
    }
  }
}
