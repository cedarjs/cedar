import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as changeCase from 'change-case'
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
import { validateName } from '../helpers.js'
import { templateForFile } from '../yargsHandlerHelpers.js'

// Try to make the name end up looking like: `WelcomeNotice` even if the user
// called it `welcome-notice` or `welcomeNoticeJob` or something like that
const normalizeName = (name) => {
  return changeCase.pascalCase(name).replace(/Job$/, '')
}

export const files = async ({
  name,
  queueName,
  typescript,
  tests: generateTests = true,
  ...rest
}) => {
  // TODO: Fix the two TODOs below, and update tests to reflect the fact that
  // jobs are camelCase instead of PascalCase, which I prefer

  // TODO: Make this use camelCase
  const jobName = normalizeName(name)
  const componentName = `${jobName}Job`
  const extension = typescript ? '.ts' : '.js'

  const jobFiles = await templateForFile({
    name: jobName,
    side: 'api',
    sidePathSection: 'jobs',
    generator: 'job',
    outputPath: path.join(componentName, componentName + extension),
    templatePath: 'job.ts.template',
    // TODO: Remove `name` here. It's already passed to the template by the
    // helper function we're using
    templateVars: { name: jobName, queueName, ...rest },
  })

  const outputFiles = []
  outputFiles.push(jobFiles)

  if (generateTests) {
    const testFile = await templateForFile({
      name: jobName,
      side: 'api',
      sidePathSection: 'jobs',
      generator: 'job',
      outputPath: path.join(componentName, componentName + `.test${extension}`),
      templatePath: 'test.ts.template',
      templateVars: { ...rest },
    })

    const scenarioFile = await templateForFile({
      name: jobName,
      side: 'api',
      sidePathSection: 'jobs',
      generator: 'job',
      outputPath: path.join(
        componentName,
        componentName + `.scenarios${extension}`,
      ),
      templatePath: 'scenarios.ts.template',
      templateVars: { ...rest },
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

  let jobFiles = {}
  const tasks = new Listr(
    [
      {
        title: 'Generating job files...',
        task: async () => {
          jobFiles = await files({ name, queueName, ...rest })
          return writeFilesTask(jobFiles, { overwriteExisting: force })
        },
      },
      {
        title: 'Cleaning up...',
        task: () => {
          execa.sync('yarn', [
            'eslint',
            '--fix',
            '--config',
            `${getPaths().base}/node_modules/@cedarjs/eslint-config/shared.js`,
            `${getPaths().api.jobsConfig}`,
            ...Object.keys(jobFiles),
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
