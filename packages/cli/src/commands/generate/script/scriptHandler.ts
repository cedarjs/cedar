import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../../../lib/colors.js'
import {
  getPaths,
  writeFilesTask,
  transformTSToJS,
  // @ts-expect-error - Types not available for JS files
} from '../../../lib/index.js'
// @ts-expect-error - Types not available for JS files
import { prepareForRollback } from '../../../lib/rollback.js'
// @ts-expect-error - Types not available for JS files
import { validateName } from '../helpers.js'
// @ts-expect-error - Types not available for JS files
import { customOrDefaultTemplatePath } from '../yargsHandlerHelpers.js'

type ScriptArgs = {
  name: string
  typescript?: boolean
  rollback?: boolean
}

export const files = async ({ name, typescript = false }: ScriptArgs) => {
  const outputFilename = `${name}.${typescript ? 'ts' : 'js'}`
  const outputPath = path.join(getPaths().scripts, outputFilename)

  const scriptTsConfigPath = path.join(getPaths().scripts, 'tsconfig.json')

  const templatePath = customOrDefaultTemplatePath({
    side: 'scripts',
    generator: 'script',
    templatePath: 'script.ts.template',
  })

  const template = fs.readFileSync(templatePath, 'utf-8')

  const tsconfigTemplatePath = customOrDefaultTemplatePath({
    side: 'scripts',
    generator: 'script',
    templatePath: 'tsconfig.json.template',
  })

  return {
    [outputPath]: typescript
      ? template
      : await transformTSToJS(outputPath, template),

    // Add tsconfig for type and cmd+click support if project is TS
    ...(typescript &&
      !fs.existsSync(scriptTsConfigPath) && {
        [scriptTsConfigPath]: fs.readFileSync(tsconfigTemplatePath, 'utf-8'),
      }),
  }
}

export const handler = async ({
  force,
  ...args
}: ScriptArgs & { force?: boolean }) => {
  recordTelemetryAttributes({
    command: 'generate script',
    force,
    rollback: args.rollback,
  })

  const POST_RUN_INSTRUCTIONS = `Next steps...\n\n   ${c.warning(
    'After modifying your script, you can invoke it like:',
  )}

     yarn cedar exec ${args.name}

     yarn cedar exec ${args.name} --param1 true
`

  validateName(args.name)

  const tasks = new Listr(
    [
      {
        title: 'Generating script file...',
        task: async () => {
          return writeFilesTask(await files(args), { overwriteExisting: force })
        },
      },
      {
        title: 'Next steps...',
        task: (_ctx: unknown, task: { title: string }) => {
          task.title = POST_RUN_INSTRUCTIONS
        },
      },
    ].filter(Boolean),
    { rendererOptions: { collapseSubtasks: false } },
  )

  try {
    if (args.rollback && !force) {
      prepareForRollback(tasks)
    }
    await tasks.run()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    errorTelemetry(process.argv, message)
    console.log(c.error(message))
    process.exit(1)
  }
}
