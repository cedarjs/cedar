import fs from 'node:fs'

import execa from 'execa'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { getPaths } from '../lib/index.js'

export const command = 'lint [path..]'
export const description = 'Lint your files'
export const builder = (yargs) => {
  yargs
    .positional('path', {
      description:
        'Specify file(s) or directory(ies) to lint relative to project root',
      type: 'array',
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

export const handler = async ({ path, fix, format }) => {
  recordTelemetryAttributes({ command: 'lint', fix, format })

  try {
    const pathString = path?.join(' ')
    const sbPath = getPaths().web.storybook
    const args = [
      'eslint',
      fix && '--fix',
      '--format',
      format,
      !pathString && fs.existsSync(getPaths().web.src) && 'web/src',
      !pathString && fs.existsSync(getPaths().web.config) && 'web/config',
      !pathString && fs.existsSync(sbPath) && 'web/.storybook',
      !pathString && fs.existsSync(getPaths().scripts) && 'scripts',
      !pathString && fs.existsSync(getPaths().api.src) && 'api/src',
      pathString,
    ].filter(Boolean)

    const result = await execa('yarn', args, {
      cwd: getPaths().base,
      stdio: 'inherit',
    })

    process.exitCode = result.exitCode
  } catch (error) {
    process.exitCode = error.exitCode ?? 1
  }
}
