import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { deleteFilesTask } from '../../lib/index.js'

type FilesFunction = (
  args: Record<string, unknown>,
) => Promise<Record<string, string>>

type PreTasksFn = (
  options: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>

const tasks = ({
  componentName,
  filesFn,
  name,
}: {
  componentName: string
  filesFn: FilesFunction
  name: string
}) =>
  new Listr(
    [
      {
        title: `Destroying ${componentName} files...`,
        task: async () => {
          const f = await filesFn({ name, stories: true, tests: true })
          return deleteFilesTask(f)
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export function createHandler({
  componentName,
  preTasksFn = (options) => options,
  filesFn,
}: {
  componentName: string
  preTasksFn?: PreTasksFn
  filesFn: FilesFunction
}) {
  return {
    handler: async (options: Record<string, unknown>) => {
      recordTelemetryAttributes({
        command: `destroy ${componentName}`,
      })
      options = await preTasksFn({ ...options, isDestroyer: true })
      await tasks({ componentName, filesFn, name: options.name as string }).run()
    },
    tasks,
  }
}
