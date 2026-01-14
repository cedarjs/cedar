import fs from 'node:fs'
import path from 'node:path'

import { paramCase, camelCase } from 'change-case'
import execa from 'execa'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { getConfig } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import { getPaths, writeFilesTask } from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'

import { files } from './filesTask.js'

/**
 * @typedef {Object} ListrContext
 * @property {Object} nameVariants - The parsed name variants for the package
 * @property {string} nameVariants.name - The base name
 * @property {string} nameVariants.folderName - The param-case folder name
 * @property {string} nameVariants.packageName - The full scoped package name
 * @property {string} nameVariants.fileName - The camelCase file name
 */

// Exported for testing
export function nameVariants(nameArg) {
  const base = path.basename(getPaths().base)

  const [orgName, name] = nameArg.startsWith('@')
    ? nameArg.slice(1).split('/', 2)
    : [paramCase(base), nameArg]

  const folderName = paramCase(name)
  const packageName = '@' + paramCase(orgName) + '/' + folderName
  const fileName = camelCase(name)

  return { name, folderName, packageName, fileName }
}

// Exported for testing
export async function updateTsconfig(task) {
  const tsconfigPath = path.join(getPaths().api.base, 'tsconfig.json')
  const tsconfig = await fs.promises.readFile(tsconfigPath, 'utf8')
  const tsconfigLines = tsconfig.split('\n')

  const moduleLineIndex = tsconfigLines.findIndex((line) =>
    /^\s*"module":\s*"/.test(line),
  )
  const moduleLine = tsconfigLines[moduleLineIndex]

  if (
    moduleLine.toLowerCase().includes('node20') ||
    // While Cedar doesn't officially endorse the usage of NodeNext, it
    // will still work here, so I won't overwrite it
    moduleLine.toLowerCase().includes('nodenext')
  ) {
    task.skip('tsconfig already up to date')
    return
  }

  tsconfigLines[moduleLineIndex] = moduleLine.replace(
    /":\s*"[\w\d]+"/,
    '": "Node20"',
  )

  await fs.promises.writeFile(tsconfigPath, tsconfigLines.join('\n'))
}

// Exported for testing
export async function updateGitignore(task) {
  const gitignorePath = path.join(getPaths().base, '.gitignore')
  const gitignore = await fs.promises.readFile(gitignorePath, 'utf8')
  const gitignoreLines = gitignore.split('\n')

  if (gitignoreLines.some((line) => line === 'tsconfig.tsbuildinfo')) {
    task.skip('tsconfig already up to date')
    return
  }

  const yarnErrorLogLineIndex = gitignoreLines.findIndex(
    (line) => line === 'yarn-error.log',
  )

  if (yarnErrorLogLineIndex === -1) {
    gitignoreLines.push('tsconfig.tsbuildinfo')
  } else {
    gitignoreLines.splice(yarnErrorLogLineIndex, 0, 'tsconfig.tsbuildinfo')
  }

  await fs.promises.writeFile(gitignorePath, gitignoreLines.join('\n'))
}

async function installAndBuild(folderName) {
  const packagePath = path.join('packages', folderName)
  await execa('yarn', ['install'], { stdio: 'inherit', cwd: getPaths().base })
  // TODO: `yarn cedar build <packageName>`
  await execa('yarn', ['build'], { stdio: 'inherit', cwd: packagePath })
}

/**
 * Handler for the generate package command.
 *
 * Creates a new package in the Cedar monorepo with the specified name and
 * configuration.
 * Sets up the package structure including source files, tests, configuration
 * files, and updates the workspace configuration.
 *
 * @param {Object} options - The command options
 * @param {string} options.name - The package name (can be scoped like
 * '@org/package' or just 'package')
 * @param {boolean} [options.force] - Whether to overwrite existing files
 * @param {boolean} [options.typescript] - Whether to generate TypeScript files
 * (passed in rest)
 * @param {boolean} [options.tests] - Whether to generate test files (passed in
 * rest)
 * @param {boolean} [options.rollback] - Whether to enable rollback on failure
 * (passed in rest)
 *
 * @returns {Promise<void>}
 *
 * @throws {Error} If the package name contains more than one slash
 * @throws {Error} If the workspace configuration is invalid
 *
 * @example
 * // Generate a basic package
 * await handler({ name: 'my-package', force: false })
 *
 * @example
 * // Generate a scoped TypeScript package with tests
 * await handler({ name: '@myorg/my-package', force: false, typescript: true, tests: true })
 */
export const handler = async ({ name, force, ...rest }) => {
  recordTelemetryAttributes({
    command: 'generate package',
    force,
    rollback: rest.rollback,
  })

  if (name.replaceAll('/', '').length < name.length - 1) {
    throw new Error(
      `Invalid package name "${name}". ` +
        'Package names can have at most one slash.',
    )
  }

  if (!getConfig().experimental.packagesWorkspace.enabled) {
    const releaseNotes = terminalLink(
      'release notes',
      'https://github.com/cedarjs/cedar/releases',
    )

    console.error(
      'This is an experimental feature. Please enable it in your ' +
        'configuration file and then run this command again.',
    )
    console.error()
    console.error(`See the ${releaseNotes} for instructions on how to enable.`)

    return
  }

  let packageFiles = {}
  const tasks = new Listr(
    /** @type {import('listr2').ListrTask<ListrContext>[]} */ ([
      {
        title: 'Parsing package name...',
        task: (ctx) => {
          ctx.nameVariants = nameVariants(name)
        },
      },
      {
        title: 'Updating workspace config...',
        task: async (ctx, task) => {
          const rootPackageJsonPath = path.join(getPaths().base, 'package.json')
          const packageJson = JSON.parse(
            await fs.promises.readFile(rootPackageJsonPath, 'utf8'),
          )

          if (!Array.isArray(packageJson.workspaces)) {
            throw new Error(
              'Invalid workspace config in ' + rootPackageJsonPath,
            )
          }

          const packagePath = `packages/${ctx.nameVariants.folderName}`
          const hasWildcardPackagesWorkspace =
            packageJson.workspaces.includes('packages/*')
          const hasNamedPackagesWorkspace =
            packageJson.workspaces.includes(packagePath)
          const hasOtherNamedPackages = packageJson.workspaces.some(
            (workspace) =>
              workspace.startsWith('packages/') && workspace !== packagePath,
          )

          if (hasWildcardPackagesWorkspace || hasNamedPackagesWorkspace) {
            task.skip('Workspaces already configured')
          } else {
            if (hasOtherNamedPackages) {
              packageJson.workspaces.push(packagePath)
            } else {
              packageJson.workspaces.push('packages/*')
            }

            await fs.promises.writeFile(
              rootPackageJsonPath,
              JSON.stringify(packageJson, null, 2),
            )
          }
        },
      },
      {
        title: 'Updating api side tsconfig file...',
        task: (_ctx, task) => updateTsconfig(task),
      },
      {
        title: 'Updating .gitignore...',
        task: (_ctx, task) => updateGitignore(task),
      },
      {
        title: 'Generating package files...',
        task: async (ctx) => {
          packageFiles = await files({ ...ctx.nameVariants, ...rest })
          return writeFilesTask(packageFiles, { overwriteExisting: force })
        },
      },
      {
        title: 'Installing and building...',
        task: (ctx) => installAndBuild(ctx.nameVariants.folderName),
      },
      {
        title: 'Cleaning up...',
        task: () => {
          execa.sync('yarn', [
            'eslint',
            '--fix',
            '--config',
            `${getPaths().base}/node_modules/@cedarjs/eslint-config/index.js`,
            ...Object.keys(packageFiles),
          ])
        },
      },
    ]),
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

  try {
    if (rest.rollback && !force) {
      prepareForRollback(tasks)
    }

    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
