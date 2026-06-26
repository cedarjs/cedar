import fs from 'node:fs'
import path from 'path'

import { Listr } from 'listr2'

import { addApiPackages, colors as c } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths, transformTSToJS, writeFile } from '../../../lib/index.js'
import { isTypeScriptProject } from '../../../lib/project.js'

const packageJson: { version: string } = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../../package.json'),
    'utf-8',
  ),
)
const { version } = packageJson

export function setupServerFileTasks({
  force = false,
}: { force?: boolean } = {}) {
  return [
    {
      title: 'Adding the server file...',
      task: async () => {
        const ts = isTypeScriptProject()

        const serverFilePath = path.join(
          getPaths().api.src,
          `server.${ts ? 'ts' : 'js'}`,
        )

        const serverFileTemplateContent = fs.readFileSync(
          path.join(import.meta.dirname, 'templates', 'server.ts.template'),
          'utf-8',
        )

        const setupScriptContent = ts
          ? serverFileTemplateContent
          : await transformTSToJS(serverFilePath, serverFileTemplateContent)

        return [
          writeFile(serverFilePath, setupScriptContent, {
            overwriteExisting: force,
          }),
        ]
      },
    },
    addApiPackages([`@cedarjs/api-server@${version}`]),
  ]
}

export async function handler({
  force,
  verbose,
}: {
  force: boolean
  verbose: boolean
}) {
  const listr = new Listr(setupServerFileTasks({ force }), {
    rendererOptions: { collapseSubtasks: false, persistentOutput: true },
    renderer: verbose ? 'verbose' : 'default',
  })

  try {
    await listr.run()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, message)
    console.error(c.error(message))
    // exitCode is a non-standard property Listr2 errors may carry
    const exitCode =
      typeof e === 'object' &&
      e !== null &&
      'exitCode' in e &&
      typeof e.exitCode === 'number'
        ? e.exitCode
        : 1
    process.exit(exitCode)
  }
}
