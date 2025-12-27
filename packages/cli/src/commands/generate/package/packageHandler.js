import fs from 'node:fs'
import path from 'node:path'

import { paramCase, camelCase } from 'change-case'
import execa from 'execa'
import { Listr } from 'listr2'

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

export const files = async ({
  name: nameArg,
  typescript,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = typescript ? '.ts' : '.js'

  const outputFiles = []

  // TODO: Extract this out into its own task that is run first, and that stores
  // the name on the Listr context so that it can be used in both the
  // workspaces task and the files task that calls this function
  const base = path.basename(getPaths().base)
  const [orgName, name] =
    nameArg[0] === '@'
      ? nameArg.split('/', 2)
      : ['@' + paramCase(base), nameArg]
  const folderName = paramCase(name)
  const packageName = orgName + '/' + folderName
  const fileName = camelCase(name)

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

    const scenarioFile = await templateForFile({
      name,
      side: 'packages',
      generator: 'package',
      templatePath: 'scenarios.ts.template',
      templateVars: rest,
      outputPath: path.join(
        folderName,
        'src',
        `${fileName}.scenarios${extension}`,
      ),
    })

    outputFiles.push(testFile)
    outputFiles.push(scenarioFile)
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
    [
      {
        title: 'Updating workspace config...',
        task: async (_ctx, task) => {
          const rootPackageJsonPath = path.join(getPaths().base, 'package.json')
          const packageJson = JSON.parse(
            await fs.promises.readFile(rootPackageJsonPath, 'utf8'),
          )

          if (!Array.isArray(packageJson.workspaces)) {
            throw new Error(
              'Invalid workspace config in ' + rootPackageJsonPath,
            )
          }

          const hasAsterixPackagesWorkspace =
            packageJson.workspaces.includes('packages/*')
          // TODO: Skip this task if "packages/<name>" already exists
          // const hasNamedPackagesWorkspace = packageJson.workspaces.find(
          //   (workspace) => workspace.startsWith('packages/'),
          // )

          if (hasAsterixPackagesWorkspace) {
            task.skip('Workspaces already configured')
          } else {
            // TODO: Push "packages/<name>" if other "packages/pkgName" exists
            // instead of the generic "packages/*"
            packageJson.workspaces.push('packages/*')

            await fs.promises.writeFile(
              rootPackageJsonPath,
              JSON.stringify(packageJson, null, 2),
            )
          }
        },
      },
      {
        title: 'Generating package files...',
        task: async () => {
          packageFiles = await files({ name, ...rest })
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
    ],
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
