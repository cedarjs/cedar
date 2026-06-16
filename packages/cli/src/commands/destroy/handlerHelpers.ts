import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { deleteFilesTask } from '../../lib/index.js'

type FilesFunction<TArgs> = (args: TArgs) => Promise<Record<string, string>>

type HandlerOptions = { name: string; isDestroyer?: boolean } & Record<
  string,
  unknown
>

type PreTasksFn = (
  options: HandlerOptions,
) => Promise<HandlerOptions> | HandlerOptions

const tasks = <TFilesArgs>({
  componentName,
  filesFn,
  name,
}: {
  componentName: string
  filesFn: FilesFunction<TFilesArgs>
  name: string
}) =>
  new Listr(
    [
      {
        title: `Destroying ${componentName} files...`,
        task: async () => {
          // The destroy flow always passes the same fixed set of fields to
          // the generator's `files` function. We assert to TFilesArgs here
          // because the caller is generic over what those extra fields are.
          const f = await filesFn({
            name,
            stories: true,
            tests: true,
          } as unknown as TFilesArgs)
          return deleteFilesTask(f)
        },
      },
    ],
    { rendererOptions: { collapseSubtasks: false }, exitOnError: true },
  )

export function createHandler<TFilesArgs>({
  componentName,
  preTasksFn = (options) => options,
  filesFn,
}: {
  componentName: string
  preTasksFn?: PreTasksFn
  filesFn: FilesFunction<TFilesArgs>
}) {
  return {
    handler: async (options: HandlerOptions) => {
      recordTelemetryAttributes({
        command: `destroy ${componentName}`,
      })
      options = await preTasksFn({ ...options, isDestroyer: true })
      await tasks({ componentName, filesFn, name: options.name }).run()
    },
    tasks,
  }
}
