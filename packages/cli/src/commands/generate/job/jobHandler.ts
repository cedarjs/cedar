import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as changeCase from 'change-case'
import { Listr } from 'listr2'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { runBinSync } from '@cedarjs/cli-helpers/packageManager/exec'
import { errorTelemetry } from '@cedarjs/telemetry'

import {
  getPaths,
  transformTSToJSMap,
  writeFilesTask,
} from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { templateForFile } from '../yargsHandlerHelpers.js'

// Try to make the name end up looking like: `WelcomeNotice` even if the user
// called it `welcome-notice` or `welcomeNoticeJob` or something like that
const normalizeName = (name: string): string => {
  return changeCase.pascalCase(name).replace(/Job$/, '')
}

export const files = async ({
  name,
  queueName,
  typescript,
  tests: generateTests = true,
  ...rest
}: {
  name: string
  queueName: string
  typescript?: boolean
  tests?: boolean
  [key: string]: unknown
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

  return transformTSToJSMap(outputFiles, typescript)
}

// This could be built using createYargsForComponentGeneration;
// however, we need to add a message after generating the function files
export const handler = async ({
  name,
  force,
  ...rest
}: {
  name: string
  force: boolean
  [key: string]: unknown
}) => {
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
  } catch {
    // We don't care if this fails because we'll fall back to 'default'
  }

  let jobFiles: Record<string, string> = {}
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
          runBinSync('eslint', [
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const exitCode =
      e instanceof Error && 'exitCode' in e && typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    process.exit(exitCode)
  }
}
