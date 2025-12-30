import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'

import { isValidCedarJSTag } from './tags.js'
import type { UpgradeOptions } from './upgradeHandler.js'

// Used in yargs builder to coerce tag AND to parse yarn version
const SEMVER_REGEX =
  /(?<=^v?|\sv?)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*)(?:\.(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*))*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?(?=$|\s)/i

const isValidSemver = (string: string) => {
  return SEMVER_REGEX.test(string)
}

export const validateTag = (tag: string) => {
  const isTagValid = isValidSemver(tag) || isValidCedarJSTag(tag)

  if (!isTagValid) {
    // Stop execution
    throw new Error(
      c.error(
        "Invalid tag supplied. Supported values: 'rc', 'canary', 'latest', 'next', 'experimental', or a valid semver version\n",
      ),
    )
  }

  return tag
}

export const command = 'upgrade'
export const description = 'Upgrade all @cedarjs packages via interactive CLI'

export const builder = (yargs: Argv) => {
  yargs
    .example(
      'cedar upgrade -t 0.20.1-canary.5',
      'Specify a version. URL for Version History:\n' +
        'https://www.npmjs.com/package/@cedarjs/core',
    )
    .option('dry-run', {
      alias: 'd',
      description: 'Check for outdated packages without upgrading',
      type: 'boolean',
    })
    .option('tag', {
      alias: 't',
      description:
        '[choices: "latest", "rc", "next", "canary", "experimental", or a ' +
        'specific-version (see example below)] WARNING: "canary", "rc" and ' +
        '"experimental" are unstable releases! And "canary" releases include ' +
        'breaking changes often requiring changes to your codebase when ' +
        'upgrading a project.',
      requiresArg: true,
      type: 'string',
      coerce: validateTag,
    })
    .option('verbose', {
      alias: 'v',
      description: 'Print verbose logs',
      type: 'boolean',
      default: false,
    })
    .option('dedupe', {
      description: 'Skip dedupe check with --no-dedupe',
      type: 'boolean',
      default: true,
    })
    .option('yes', {
      alias: 'y',
      describe: 'Skip prompts and use defaults',
      default: false,
      type: 'boolean',
    })
    .option('force', {
      alias: 'f',
      describe: 'Force upgrade even if pre-upgrade checks fail',
      default: false,
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'CedarJS CLI Reference for the upgrade command',
        'https://cedarjs.com/docs/cli-commands#upgrade',
      )}.\nAnd the ${terminalLink(
        'GitHub releases page',
        'https://github.com/cedarjs/cedar/releases',
      )} for more information on the current release.`,
    )
}

export const handler = async (options: UpgradeOptions) => {
  const { handler } = await import('./upgradeHandler.js')

  return handler(options)
}
