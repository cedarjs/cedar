import fs from 'node:fs'
import path from 'node:path'

import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer'
import { paramCase, camelCase } from 'change-case'
import execa from 'execa'
import { modify, applyEdits } from 'jsonc-parser'
import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'
import ts from 'typescript'

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
  const targets = [
    {
      name: 'api',
      path: path.join(getPaths().api.base, 'tsconfig.json'),
      expectedModule: 'Node20',
      // While Cedar doesn't officially endorse NodeNext, it will still work
      // here, so we'll keep it
      acceptable: ['node20', 'nodenext'],
    },
    {
      name: 'web',
      path: path.join(getPaths().web.base, 'tsconfig.json'),
      expectedModule: 'ESNext',
      acceptable: ['esnext', 'es2022'],
    },
    {
      name: 'scripts',
      path: path.join(getPaths().scripts, 'tsconfig.json'),
      expectedModule: 'Node20',
      acceptable: ['node20', 'nodenext'],
    },
  ]

  let didUpdate = false

  for (const target of targets) {
    if (!fs.existsSync(target.path)) {
      continue
    }

    const tsconfigText = await fs.promises.readFile(target.path, 'utf8')

    const { config: tsconfig, error } = ts.parseConfigFileTextToJson(
      target.path,
      tsconfigText,
    )

    if (error) {
      throw new Error(
        'Failed to parse tsconfig: ' + JSON.stringify(error, null, 2),
      )
    }

    // Only update tsconfigs that explicitly set a "module" value. We don't
    // want to add a new module entry where none existed before.
    if (
      !tsconfig?.compilerOptions ||
      typeof tsconfig.compilerOptions.module === 'undefined'
    ) {
      // If there is no "module" entry, skip this tsconfig
      continue
    }

    const currentModule =
      typeof tsconfig.compilerOptions.module === 'string'
        ? tsconfig.compilerOptions.module.toLowerCase()
        : String(tsconfig.compilerOptions.module).toLowerCase()

    const alreadySet = target.acceptable.some((acc) => {
      return currentModule.includes(acc)
    })

    if (alreadySet) {
      continue
    }

    const edits = modify(
      tsconfigText,
      ['compilerOptions', 'module'],
      target.expectedModule,
      {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      },
    )

    if (edits.length === 0) {
      const newConfig = { ...tsconfig }

      if (!newConfig.compilerOptions) {
        newConfig.compilerOptions = {}
      }

      newConfig.compilerOptions.module = target.expectedModule

      await fs.promises.writeFile(
        target.path,
        JSON.stringify(newConfig, null, 2),
        'utf8',
      )
    } else {
      const newText = applyEdits(tsconfigText, edits)
      await fs.promises.writeFile(target.path, newText, 'utf8')
    }

    didUpdate = true
  }

  if (!didUpdate) {
    task.skip('tsconfig already up to date')
    return
  }
}

// Exported for testing
export async function updateGitignore(task) {
  const gitignorePath = path.join(getPaths().base, '.gitignore')
  const gitignore = await fs.promises.readFile(gitignorePath, 'utf8')
  const gitignoreLines = gitignore.split('\n')

  if (gitignoreLines.some((line) => line === 'tsconfig.tsbuildinfo')) {
    task.skip('.gitignore already up to date')
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

// Exported for testing
export async function addDependencyToPackageJson(
  task,
  packageJsonPath,
  packageName,
) {
  if (!fs.existsSync(packageJsonPath)) {
    task.skip('package.json not found')
    return
  }

  const packageJson = JSON.parse(
    await fs.promises.readFile(packageJsonPath, 'utf8'),
  )

  if (!packageJson.dependencies) {
    packageJson.dependencies = {}
  }

  if (packageJson.dependencies[packageName]) {
    task.skip('Dependency already exists')
    return
  }

  packageJson.dependencies[packageName] = 'workspace:*'

  await fs.promises.writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2),
  )
}

// Exported for testing
export function parseWorkspaceFlag(workspace) {
  if (workspace === undefined || workspace === null) {
    return undefined
  }

  const ws = String(workspace).trim().toLowerCase()
  const allowed = ['none', 'api', 'web', 'both']

  if (!allowed.includes(ws)) {
    throw new Error(
      `Invalid workspace value "${workspace}". Valid options: ${allowed.join(', ')}`,
    )
  }

  return ws
}

export function updateWorkspaceTsconfigReferences(
  task,
  folderName,
  targetWorkspaces,
) {
  if (!targetWorkspaces || targetWorkspaces === 'none') {
    task.skip('No workspace selected')
    return
  }

  // Update workspace tsconfigs (api/web/scripts)
  const workspaces = []

  const packageDir = path.join(getPaths().base, 'packages', folderName)

  if (targetWorkspaces === 'api' || targetWorkspaces === 'both') {
    const tsconfigPath = path.join(getPaths().api.base, 'tsconfig.json')
    workspaces.push({ name: 'api', tsconfigPath, packageDir })
  }

  if (targetWorkspaces === 'web' || targetWorkspaces === 'both') {
    const tsconfigPath = path.join(getPaths().web.base, 'tsconfig.json')
    workspaces.push({ name: 'web', tsconfigPath, packageDir })
  }

  // Also update the scripts tsconfig (if present) for any selection other than
  // 'none'
  if (targetWorkspaces !== 'none') {
    const tsconfigPath = path.join(getPaths().scripts, 'tsconfig.json')
    workspaces.push({ name: 'scripts', tsconfigPath, packageDir })
  }

  if (workspaces.length === 0) {
    task.skip('No workspace selected')
    return
  }

  const subtasks = workspaces.map((ws) => {
    return {
      title: `Updating ${ws.name} tsconfig references...`,
      task: async (_ctx, subtask) => {
        if (!fs.existsSync(ws.tsconfigPath)) {
          subtask.skip('tsconfig.json not found')
          return
        }

        const tsconfigText = await fs.promises.readFile(ws.tsconfigPath, 'utf8')
        const { config: tsconfig, error } = ts.parseConfigFileTextToJson(
          ws.tsconfigPath,
          tsconfigText,
        )
        if (error) {
          throw new Error(
            'Failed to parse tsconfig: ' + JSON.stringify(error, null, 2),
          )
        }

        // Parse for additional diagnostics using an fs-backed host so that
        // extends and other file resolution also use the same fs
        // implementation.
        // This makes testing easier with a mock fs implementation.
        const configParseResult = ts.parseJsonConfigFileContent(
          tsconfig,
          {
            ...ts.sys,
            readFile: (p) => {
              try {
                return fs.readFileSync(p, 'utf8')
              } catch (e) {
                return ts.sys.readFile(p)
              }
            },
            fileExists: (p) => {
              if (typeof fs.existsSync === 'function') {
                return fs.existsSync(p)
              }
              return ts.sys.fileExists(p)
            },
          },
          path.dirname(ws.tsconfigPath),
        )

        if (configParseResult.errors && configParseResult.errors.length) {
          console.error('Parse errors:', configParseResult.errors)
        }

        if (!Array.isArray(tsconfig.references)) {
          tsconfig.references = []
        }

        const packageDir =
          ws.packageDir || path.join(getPaths().base, 'packages', folderName)
        const referencePath = path
          .relative(path.dirname(ws.tsconfigPath), packageDir)
          .split(path.sep)
          .join('/')

        const references = tsconfig.references

        if (references.some((ref) => ref && ref.path === referencePath)) {
          subtask.skip('tsconfig already up to date')
          return
        }

        const newReferences = references.concat([{ path: referencePath }])

        let text = await fs.promises.readFile(ws.tsconfigPath, 'utf8')

        const edits = modify(text, ['references'], newReferences, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        })

        if (edits.length === 0) {
          await fs.promises.writeFile(
            ws.tsconfigPath,
            JSON.stringify({ ...tsconfig, references: newReferences }, null, 2),
            'utf8',
          )
        } else {
          const newText = applyEdits(text, edits)
          await fs.promises.writeFile(ws.tsconfigPath, newText, 'utf8')
        }
      },
    }
  })

  return new Listr(subtasks)
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
        'cedar.toml (or redwood.toml) file and then run this command again.',
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
        title: 'Choose package workspace(s)...',
        task: async (ctx, task) => {
          // If the CLI flag `--workspace` was provided, validate and use it:
          try {
            const flagValue = parseWorkspaceFlag(rest.workspace)
            if (flagValue !== undefined) {
              ctx.targetWorkspaces = flagValue
              task.skip(
                `Using workspace provided via --workspace: ${flagValue}`,
              )
              return
            }
          } catch (e) {
            // Bubble up validation errors to the user
            throw new Error(e.message)
          }

          const prompt = task.prompt(ListrEnquirerPromptAdapter)
          const response = await prompt.run({
            type: 'select',
            message: 'Which workspace(s) should use this package?',
            choices: [
              { message: 'none (I will add it manually later)', value: 'none' },
              { message: 'api', value: 'api' },
              { message: 'web', value: 'web' },
              { message: 'both', value: 'both' },
            ],
          })

          ctx.targetWorkspaces = response
        },
      },
      {
        title: 'Updating tsconfig files...',
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
        title: 'Adding package to workspace dependencies...',
        task: async (ctx, task) => {
          if (!ctx.targetWorkspaces || ctx.targetWorkspaces === 'none') {
            task.skip('No workspace selected')
            return
          }

          const subtasks = []

          if (
            ctx.targetWorkspaces === 'api' ||
            ctx.targetWorkspaces === 'both'
          ) {
            subtasks.push({
              title: 'Adding to api package.json...',
              task: async (_subCtx, subtask) => {
                const apiPackageJsonPath = path.join(
                  getPaths().api.base,
                  'package.json',
                )

                return addDependencyToPackageJson(
                  subtask,
                  apiPackageJsonPath,
                  ctx.nameVariants.packageName,
                )
              },
            })
          }

          if (
            ctx.targetWorkspaces === 'web' ||
            ctx.targetWorkspaces === 'both'
          ) {
            subtasks.push({
              title: 'Adding to web package.json...',
              task: async (_subCtx, subtask) => {
                const webPackageJsonPath = path.join(
                  getPaths().web.base,
                  'package.json',
                )

                return addDependencyToPackageJson(
                  subtask,
                  webPackageJsonPath,
                  ctx.nameVariants.packageName,
                )
              },
            })
          }

          if (subtasks.length === 0) {
            task.skip('No workspace selected')
            return
          }

          return new Listr(subtasks)
        },
      },
      {
        title: 'Updating tsconfig references...',
        task: (ctx, task) => {
          if (!ctx.targetWorkspaces || ctx.targetWorkspaces === 'none') {
            task.skip('No workspace selected')
            return
          }

          return updateWorkspaceTsconfigReferences(
            task,
            ctx.nameVariants.folderName,
            ctx.targetWorkspaces,
          )
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
      // TODO: Also remove tsconfig.tsbuildinfo
      prepareForRollback(tasks)
    }

    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
