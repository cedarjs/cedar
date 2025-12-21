import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import c from '../../../lib/colors.js'
import { transformTSToJS, writeFilesTask } from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { templateForComponentFile } from '../yargsHandlerHelpers.js'

export const files = async ({
  name,
  typescript: generateTypescript = false,
  tests: generateTests = true,
  ...rest
}) => {
  const extension = generateTypescript ? '.ts' : '.js'

  const outputFiles = []

  const functionFiles = await templateForComponentFile({
    name,
    extension,
    apiPathSection: 'functions',
    generator: 'function',
    templatePath: 'function.ts.template',
    templateVars: { ...rest, typescript: generateTypescript },
  })

  outputFiles.push(functionFiles)

  if (generateTests) {
    const testFile = await templateForComponentFile({
      name,
      extension: `.test${extension}`,
      apiPathSection: 'functions',
      generator: 'function',
      templatePath: 'test.ts.template',
      templateVars: { ...rest },
    })

    const scenarioFile = await templateForComponentFile({
      name,
      extension: `.scenarios${extension}`,
      apiPathSection: 'functions',
      generator: 'function',
      templatePath: 'scenarios.ts.template',
      templateVars: { ...rest },
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
    command: 'generate function',
    force,
    rollback: rest.rollback,
  })

  validateName(name)

  const tasks = new Listr(
    [
      {
        title: 'Generating function files...',
        task: async () => {
          return writeFilesTask(await files({ name, ...rest }), {
            overwriteExisting: force,
          })
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

    console.info('')
    console.info(c.warning('⚠ Important:'))
    console.info('')

    console.info(
      c.bold(
        'When deployed, a custom serverless function is an open API endpoint and ' +
          'is your responsibility to secure appropriately.',
      ),
    )

    console.info('')
    console.info(
      `Please consult the ${terminalLink(
        'Serverless Function Considerations',
        'https://redwoodjs.com/docs/serverless-functions#security-considerations',
      )} in the RedwoodJS documentation for more information.`,
    )
    console.info('')
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
