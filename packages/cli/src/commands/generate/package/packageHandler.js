import fs from 'node:fs'
import path from 'node:path'

import { paramCase, camelCase } from 'change-case'
import execa from 'execa'
import { Listr } from 'listr2'

/**
 * @typedef {Object} ListrContext
 * @property {Object} nameVariants - The parsed name variants for the package
 * @property {string} nameVariants.name - The base name
 * @property {string} nameVariants.folderName - The param-case folder name
 * @property {string} nameVariants.packageName - The full scoped package name
 * @property {string} nameVariants.fileName - The camelCase file name
 */

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import {
  getPaths,
  transformTSToJS,
  writeFilesTask,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { templateForFile } from '../yargsHandlerHelpers.js'

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

/**
 * Generates the file structure and content for a new package.
 *
 * Creates all necessary files for a package including source files, configuration,
 * README, and optionally test files. Handles both TypeScript and JavaScript generation.
 *
 * @param {Object} options - The file generation options
 * @param {string} options.name - The package name
 * @param {string} options.folderName - The folder name for the package (param-case)
 * @param {string} options.packageName - The full scoped package name (e.g., '@org/package')
 * @param {string} options.fileName - The camelCase file name
 * @param {boolean} [options.typescript] - Whether to generate TypeScript files (defaults to JS if not provided)
 * @param {boolean} [options.tests=true] - Whether to generate test files
 *
 * @returns {Promise<Object>} A promise that resolves to an object mapping file paths to their content
 *
 * @example
 * // Generate TypeScript package files with tests
 * const fileMap = await files({
 *   name: 'MyPackage',
 *   folderName: 'my-package',
 *   packageName: '@myorg/my-package',
 *   fileName: 'myPackage',
 *   typescript: true,
 *   tests: true
 * })
 */
// Exported for testing
export const files = async ({
  name,
  folderName,
  packageName,
  fileName,
  typescript,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = typescript ? '.ts' : '.js'

  const outputFiles = []

  const indexFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'index.ts.template',
    templateVars: rest,
    outputPath: path.join(folderName, 'src', `index${extension}`),
  })

  const readmeFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'README.md.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'README.md'),
  })

  const packageJsonFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'package.json.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'package.json'),
  })

  const tsconfigFile = await templateForFile({
    name,
    side: 'packages',
    generator: 'package',
    templatePath: 'tsconfig.json.template',
    templateVars: { packageName, ...rest },
    outputPath: path.join(folderName, 'tsconfig.json'),
  })

  outputFiles.push(indexFile)
  outputFiles.push(readmeFile)
  outputFiles.push(packageJsonFile)
  outputFiles.push(tsconfigFile)

  if (generateTests) {
    const testFile = await templateForFile({
      name,
      side: 'packages',
      generator: 'package',
      templatePath: 'test.ts.template',
      templateVars: rest,
      outputPath: path.join(folderName, 'src', `${fileName}.test${extension}`),
    })

    outputFiles.push(testFile)
  }

  return outputFiles.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template =
      typescript || outputPath.endsWith('.md') || outputPath.endsWith('.json')
        ? content
        : await transformTSToJS(outputPath, content)

    return {
      [outputPath]: template,
      ...acc,
    }
  }, Promise.resolve({}))
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
        task: async (_ctx, task) => {
          await updateTsconfig(task)
        },
      },
      {
        title: 'Generating package files...',
        task: async (ctx) => {
          packageFiles = await files({
            ...ctx.nameVariants,
            ...rest,
          })
          return writeFilesTask(packageFiles, { overwriteExisting: force })
        },
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
