import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const command = 'package <npm-package>'
export const description =
  'Run a bin from an NPM package with version compatibility checks'

export const builder = (yargs: Argv) => {
  yargs
    .positional('npm-package', {
      description:
        'The NPM package to run. This can be a package name or a package name with a version or tag.',
      type: 'string',
    })
    .option('force', {
      default: false,
      description:
        'Proceed with a potentially incompatible version of the package',
      type: 'boolean',
      alias: 'f',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference',
        'https://cedarjs.com/docs/cli-commands#lint',
      )}`,
    )
}

export const handler = async (options: {
  // yargs auto-generates a camelCase alias alongside the kebab-case positional
  'npm-package': string
  npmPackage: string
  force: boolean
}) => {
  recordTelemetryAttributes({
    command: 'setup package',
  })

  const { handler } = await import('./packageHandler.js')
  return handler(options)
}
