import fs from 'node:fs'

import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { recordTelemetryAttributes } from "@cedarjs/cli-helpers/telemetry";
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
