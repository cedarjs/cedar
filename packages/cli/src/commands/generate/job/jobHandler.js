import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as changeCase from 'change-case'
import execa from 'execa'
import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@redmix/cli-helpers'
import { errorTelemetry } from '@redmix/telemetry'

import c from '../../../lib/colors.js'
import {
  getPaths,
  transformTSToJS,
  writeFilesTask,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { templateForComponentFile } from '../yargsHandlerHelpers.js'

// Try to make the name end up looking like: `WelcomeNotice` even if the user
// called it `welcome-notice` or `welcomeNoticeJob` or something like that
const normalizeName = (name) => {
  return changeCase.pascalCase(name).replace(/Job$/, '')
}

export const files = async ({
  name,
  queueName,
  typescript: generateTypescript,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = generateTypescript ? '.ts' : '.js'

  const outputFiles = []

  const jobName = normalizeName(name)

  const jobFiles = await templateForComponentFile({
    name: jobName,
    componentName: jobName,
    extension,
    apiPathSection: 'jobs',
    generator: 'job',
    templatePath: 'job.ts.template',
    templateVars: { name: jobName, queueName, ...rest },
    outputPath: path.join(
      getPaths().api.jobs,
      `${jobName}Job`,
      `${jobName}Job${extension}`,
    ),
  })

  outputFiles.push(jobFiles)

  if (generateTests) {
    const testFile = await templateForComponentFile({
      name: jobName,
      componentName: jobName,
      extension,
      apiPathSection: 'jobs',
      generator: 'job',
      templatePath: 'test.ts.template',
      templateVars: { ...rest },
      outputPath: path.join(
        getPaths().api.jobs,
        `${jobName}Job`,
        `${jobName}Job.test${extension}`,
      ),
    })

    const scenarioFile = await templateForComponentFile({
      name: jobName,
      componentName: jobName,
      extension,
      apiPathSection: 'jobs',
      generator: 'job',
      templatePath: 'scenarios.ts.template',
      templateVars: { ...rest },
      outputPath: path.join(
        getPaths().api.jobs,
        `${jobName}Job`,
        `${jobName}Job.scenarios${extension}`,
      ),
    })

    outputFiles.push(testFile)
    outputFiles.push(scenarioFile)
  }

  return outputFiles.reduce(async (accP, [outputPath, content]) => {
    const acc = await accP

    const template = generateTypescript
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
    command: 'generate job',
    force,
    rollback: rest.rollback,
  })

  validateName(name)

  let queueName = 'default'

  // Attempt to read the first queue in the user's job config file
  try {
    const jobsManagerFile = getPaths().api.distJobsConfig
    const jobManager = await import(pathToFileURL(jobsManagerFile).href)
    queueName = jobManager.jobs?.queues[0] ?? 'default'
  } catch (_e) {
    // We don't care if this fails because we'll fall back to 'default'
  }

  const tasks = new Listr(
    [
      {
        title: 'Generating job files...',
        task: async () => {
          const jobFiles = await files({ name, queueName, ...rest })
          return writeFilesTask(jobFiles, { overwriteExisting: force })
        },
      },
      {
        title: 'Cleaning up...',
        task: () => {
          execa.commandSync('yarn', [
            'eslint',
            '--fix',
            '--config',
            `${getPaths().base}/node_modules/@redmix/eslint-config/shared.js`,
            `${getPaths().api.jobsConfig}`,
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
