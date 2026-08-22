import fs from 'node:fs'
import path from 'node:path'

import { colors } from '@cedarjs/cli-helpers'
import { formatAddRootPackagesCommand } from '@cedarjs/cli-helpers/packageManager/display'
import { getPaths } from '@cedarjs/project-config'

// TODO: Remove this whole module, and its call site in `lint.ts`, in the next
// major release. It only exists to give people upgrading from v5 an actionable
// error for the two breaking ESLint changes in v6: flat config became
// mandatory (#2244), and `@cedarjs/core` stopped depending on
// `@cedarjs/eslint-config` (#2249), so projects that never listed the config
// package themselves suddenly had no ESLint at all. By the next major everyone
// will have moved past both.

const FLAT_CONFIG_FILENAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
]

const LEGACY_CONFIG_FILENAMES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.mjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
]

const MIGRATION_GUIDE_URL =
  'https://github.com/cedarjs/cedar/blob/main/packages/eslint-config/README.md#migrating-from-legacy-eslintrcjs-config'

/**
 * Returns the path to the project's flat ESLint config, or `undefined` if it
 * doesn't have one.
 */
function findFlatConfig(base: string) {
  return FLAT_CONFIG_FILENAMES.map((filename) =>
    path.join(base, filename),
  ).find((configPath) => fs.existsSync(configPath))
}

/**
 * Reads and parses the project's root package.json. Returns `undefined` if it
 * can't be read or parsed — that's not this check's problem to report on.
 */
function readRootPackageJson(
  base: string,
): Record<string, unknown> | undefined {
  try {
    const contents = fs.readFileSync(path.join(base, 'package.json'), 'utf-8')
    const parsed: unknown = JSON.parse(contents)

    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }

    return undefined
  } catch {
    return undefined
  }
}

function hasLegacyConfig(
  base: string,
  packageJson: Record<string, unknown> | undefined,
) {
  const hasLegacyConfigFile = LEGACY_CONFIG_FILENAMES.some((filename) =>
    fs.existsSync(path.join(base, filename)),
  )

  return hasLegacyConfigFile || Boolean(packageJson?.['eslintConfig'])
}

function listsEslintConfigPackage(packageJson: Record<string, unknown>) {
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = packageJson[field]

    return (
      deps !== null &&
      typeof deps === 'object' &&
      '@cedarjs/eslint-config' in deps
    )
  })
}

/**
 * The `<pm> add -D @cedarjs/eslint-config@<version>` line we tell people to
 * run, pinned to the version of Cedar they're currently running.
 */
async function formatAddConfigPackageCommand() {
  let version = ''

  try {
    const packageJson: { default: { version: string } } = await import(
      '../../package.json',
      { with: { type: 'json' } }
    )

    version = '@' + packageJson.default.version
  } catch {
    // Not being able to read our own version is no reason to withhold the
    // rest of the advice — just suggest the unpinned package instead.
  }

  try {
    return formatAddRootPackagesCommand(
      ['@cedarjs/eslint-config' + version],
      true,
    )
  } catch {
    // Detecting the package manager can throw. Falling back to yarn syntax is
    // better than letting this check blow up in place of the advice it exists
    // to give.
    return 'yarn add -D @cedarjs/eslint-config' + version
  }
}

async function legacyConfigMessage(
  packageJson: Record<string, unknown> | undefined,
) {
  const needsConfigPackage =
    !packageJson || !listsEslintConfigPackage(packageJson)

  return [
    colors.error("Cedar no longer supports ESLint's legacy config format"),
    '',
    'Support for `.eslintrc.*` and the `eslintConfig` field in package.json',
    'was removed in v6. Create an `eslint.config.mjs` in your project root',
    '(`eslint.config.js` if your project is ESM, i.e. has `"type": "module"`):',
    '',
    colors.tip("  import cedarConfig from '@cedarjs/eslint-config'"),
    '',
    colors.tip('  export default await cedarConfig()'),
    '',
    'Then delete your `.eslintrc.*` file and remove the `eslintConfig` field',
    'from package.json, moving any custom rules you had into an extra config',
    'object after `cedarConfig()`.',
    ...(needsConfigPackage
      ? [
          '',
          "You'll also need `@cedarjs/eslint-config` itself, which is no longer",
          'installed for you:',
          '',
          colors.tip('  ' + (await formatAddConfigPackageCommand())),
        ]
      : []),
    '',
    'Full migration guide: ' + colors.link(MIGRATION_GUIDE_URL),
  ].join('\n')
}

async function missingConfigPackageMessage(flatConfigPath: string) {
  return [
    colors.error('Cannot find `@cedarjs/eslint-config`'),
    '',
    `Your ${path.basename(flatConfigPath)} uses \`@cedarjs/eslint-config\`, but`,
    "the package isn't listed in your project's package.json. As of v6,",
    '`@cedarjs/core` no longer depends on it, so projects have to declare it',
    'themselves:',
    '',
    colors.tip('  ' + (await formatAddConfigPackageCommand())),
    '',
    colors.info(
      '`@cedarjs/eslint-config` brings its own ESLint, so you do not need to ' +
        'add `eslint` separately.',
    ),
  ].join('\n')
}

/**
 * Checks for the two ESLint setups that v6 stopped supporting and returns an
 * actionable error message for them. Returns `undefined` when there's nothing
 * to complain about, in which case ESLint should just be run as usual.
 */
export async function getEslintSetupError() {
  const base = getPaths().base
  const packageJson = readRootPackageJson(base)
  const flatConfigPath = findFlatConfig(base)

  if (!flatConfigPath) {
    // No flat config and no legacy config either. ESLint's own "couldn't find
    // a configuration file" error is clear enough, and this isn't the v6
    // upgrade problem we're here to explain.
    if (!hasLegacyConfig(base, packageJson)) {
      return undefined
    }

    return legacyConfigMessage(packageJson)
  }

  if (!packageJson || listsEslintConfigPackage(packageJson)) {
    return undefined
  }

  // A project is free to bring its own ESLint setup, so only insist on
  // `@cedarjs/eslint-config` when the config actually reaches for it.
  const flatConfig = fs.readFileSync(flatConfigPath, 'utf-8')

  if (!flatConfig.includes('@cedarjs/eslint-config')) {
    return undefined
  }

  return missingConfigPackageMessage(flatConfigPath)
}
