import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { deleteFilesTask } from '../../lib/index.js'

type FilesArgsBase = {
  name: string
  stories: boolean
  tests: boolean
}

type FilesFunction = (args: FilesArgsBase) => Promise<Record<string, string>>

type HandlerOptions = { name: string; isDestroyer?: boolean } & Record<
  string,
  unknown
>

type PreTasksFn = (
  options: HandlerOptions,
) => Promise<HandlerOptions> | HandlerOptions

export interface TasksArgs {
  componentName: string
  filesFn: FilesFunction
  name: string
}

function tasks({ componentName, filesFn, name }: TasksArgs) {
  return new Listr(
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
}

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
    handler: async (options: HandlerOptions) => {
      recordTelemetryAttributes({ command: `destroy ${componentName}` })

      const { name } = await preTasksFn({ ...options, isDestroyer: true })
      await tasks({ componentName, filesFn, name }).run()
    },
    tasks,
  }
}
