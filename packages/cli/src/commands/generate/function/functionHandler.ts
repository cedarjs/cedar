import { Listr } from 'listr2'
import { terminalLink } from 'termi-link'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { transformTSToJSMap, writeFilesTask } from '../../../lib/index.js'
import { prepareForRollback } from '../../../lib/rollback.js'
import { validateName } from '../helpers.js'
import { templateForComponentFile } from '../yargsHandlerHelpers.js'
import type { HandlerArgv } from '../yargsHandlerHelpers.js'

type FunctionFilesArgv = HandlerArgv & {
  typescript?: boolean
  tests?: boolean
}

export const files = async ({
  name,
  typescript: generateTypescript = false,
  tests: generateTests = true,
  ...rest
}: FunctionFilesArgv): Promise<Record<string, string>> => {
  const extension = generateTypescript ? '.ts' : '.js'

  const outputFiles: [string, string][] = []

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

  return transformTSToJSMap(outputFiles, generateTypescript)
}

// This could be built using createYargsForComponentGeneration;
// however, we need to add a message after generating the function files
type FunctionHandlerArgv = HandlerArgv & {
  force: boolean
}

export const handler = async ({
  name,
  force,
  ...rest
}: FunctionHandlerArgv) => {
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
        'https://cedarjs.com/docs/serverless-functions#security-considerations',
      )} in the CedarJS documentation for more information.`,
    )
    console.info('')
  } catch (e) {
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
