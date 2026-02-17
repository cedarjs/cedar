import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import { terminalLink } from 'termi-link'
import type { Argv } from 'yargs'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import { getPaths, getConfig } from '../lib/index.js'

/**
 * Checks for legacy ESLint configuration files in the project root
 * @returns {string[]} Array of legacy config file names found
 */
function detectLegacyEslintConfig() {
  const projectRoot = getPaths().base
  const legacyConfigFiles = [
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
  ]

  const foundLegacyFiles: string[] = []

  // Check for .eslintrc.* files
  for (const configFile of legacyConfigFiles) {
    if (fs.existsSync(path.join(projectRoot, configFile))) {
      foundLegacyFiles.push(configFile)
    }
  }

  // Check for eslint or eslintConfig fields in package.json
  const packageJsonPath = path.join(projectRoot, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.eslintConfig) {
        foundLegacyFiles.push('package.json (eslintConfig field)')
      }
      if (packageJson.eslint) {
        foundLegacyFiles.push('package.json (eslint field)')
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  return foundLegacyFiles
}

/**
 * Shows a deprecation warning for legacy ESLint configuration
 * @param {string[]} legacyFiles Array of legacy config file names
 */
function showLegacyEslintDeprecationWarning(legacyFiles: string[]) {
  console.warn('')
  console.warn('⚠️  DEPRECATION WARNING: Legacy ESLint Configuration Detected')
  console.warn('')
  console.warn('   The following legacy ESLint configuration files were found:')
  legacyFiles.forEach((file) => {
    console.warn(`   - ${file}`)
  })
  console.warn('')
  console.warn(
    '   Cedar has migrated to ESLint flat config format. Legacy configurations',
  )
  console.warn(
    '   still work but are deprecated and will be removed in a future version.',
  )
  console.warn('')
  console.warn('   To migrate to the new format:')
  console.warn('   1. Remove the legacy config file(s) listed above')
  console.warn('   2. Create an eslint.config.mjs')
  console.warn('   3. Use the flat config format with @cedarjs/eslint-config')
  console.warn('')
  console.warn('   See more here: https://github.com/cedarjs/cedar/pull/629')
  console.warn('')
}

export const command = 'lint [paths..]'
export const description = 'Lint your files'
type LintOptions = {
  paths?: string[]
  fix?: boolean
  format?: string
}
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

export const handler = async ({
  paths = [],
  fix = false,
  format = 'stylish',
}: LintOptions) => {
  recordTelemetryAttributes({ command: 'lint', fix, format })

  // Check for legacy ESLint configuration and show deprecation warning
  const config = getConfig()
  const legacyConfigFiles = detectLegacyEslintConfig()
  if (legacyConfigFiles.length > 0 && config.eslintLegacyConfigWarning) {
    showLegacyEslintDeprecationWarning(legacyConfigFiles)
  }

  try {
    const sbPath = getPaths().web.storybook
    const args = ['eslint', fix && '--fix', '--format', format, ...paths]

    if (paths.length === 0) {
      args.push(
        fs.existsSync(getPaths().web.src) && 'web/src',
        fs.existsSync(getPaths().web.config) && 'web/config',
        fs.existsSync(sbPath) && 'web/.storybook',
        fs.existsSync(getPaths().scripts) && 'scripts',
        fs.existsSync(getPaths().api.src) && 'api/src',
      )
    }

    const filteredArgs = args.filter((arg): arg is string => Boolean(arg))

    const result = await execa('yarn', filteredArgs, {
      cwd: getPaths().base,
      stdio: 'inherit',
    })

    process.exitCode = result.exitCode
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'exitCode' in error) {
      process.exitCode = (error as { exitCode?: number }).exitCode ?? 1
      return
    }

    process.exitCode = 1
  }
}
