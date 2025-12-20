import path from 'node:path'

import { paramCase } from 'change-case'
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
import {
  templateForComponentFile,
  templateForFile,
} from '../yargsHandlerHelpers.js'

export const files = async ({
  name: nameArg,
  typescript,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = typescript ? '.ts' : '.js'

  const outputFiles = []

  const base = path.basename(getPaths().base)

  console.log('name', nameArg)
  console.log('base', base)

  const [orgName, name] =
    nameArg[0] === '@' ? nameArg.split('/', 2) : ['@' + base, nameArg]

  console.log('orgName', orgName)
  console.log('pkgName', name)

  const folderName = paramCase(name)
  const packageName = orgName + '/' + folderName

  console.log('folderName', folderName)
  console.log('packageName', packageName)
  console.log('packagesPath', getPaths().packages)

  const packageFiles = await templateForFile({
    name: packageName,
    componentName: packageName,
    extension,
    apiPathSection: 'packages',
    generator: 'package',
    templatePath: 'index.ts.template',
    templateVars: { name, packageName, ...rest },
    outputPath: path.join(
      getPaths().packages,
      orgName,
      `${packageName}`,
      `${packageName}{extension}`,
    ),
  })

  outputFiles.push(packageFiles)

  const readmeFile = await templateForComponentFile({
    name: packageName,
    componentName: packageName,
    extension,
    apiPathSection: 'packages',
    generator: 'package',
    templatePath: 'README.md.template',
    templateVars: { name, packageName, ...rest },
    outputPath: path.join(
      getPaths().packages,
      orgName,
      `${packageName}`,
      `${packageName}{extension}`,
    ),
  })

  outputFiles.push(readmeFile)

  if (generateTests) {
    const testFile = await templateForComponentFile({
      name: packageName,
      componentName: packageName,
      extension,
      apiPathSection: 'jobs',
      generator: 'job',
      templatePath: 'test.ts.template',
      templateVars: { ...rest },
      outputPath: path.join(
        getPaths().api.jobs,
        `${packageName}Job`,
        `${packageName}Job.test${extension}`,
      ),
    })

    const scenarioFile = await templateForComponentFile({
      name: packageName,
      componentName: packageName,
      extension,
      apiPathSection: 'jobs',
      generator: 'job',
      templatePath: 'scenarios.ts.template',
      templateVars: { ...rest },
      outputPath: path.join(
        getPaths().api.jobs,
        `${packageName}Job`,
        `${packageName}Job.scenarios${extension}`,
      ),
    })

    outputFiles.push(testFile)
    outputFiles.push(scenarioFile)
  }

  return outputFiles.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template = typescript
      ? content
      : await transformTSToJS(outputPath, content)

    return {
      [outputPath]: template,
      ...acc,
    }
  }, Promise.resolve({}))
}

// This could be built using createYargsForComponentGeneration;
// however, we need to add a message after generating the function files
export const handler = async ({ name, force, ...rest }) => {
  recordTelemetryAttributes({
    command: 'generate package',
    force,
    rollback: rest.rollback,
  })

  console.log('name', name)

  if (name.replaceAll('/', '').length < name.length - 1) {
    throw new Error(
      `Invalid package name "${name}". Package names can have at most one slash.`,
    )
  }

  let packageFiles = {}
  const tasks = new Listr(
    [
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
