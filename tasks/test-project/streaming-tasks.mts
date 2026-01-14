import { createBuilder, fullPath, setOutputPath } from './base-tasks.mts'
import { applyCodemod } from './util.mts'

/**
 * Separates the streaming-ssr related steps. These are all web tasks,
 * if we choose to move them later
 * @param {string} outputPath
 */
export function streamingTasks(outputPath: string) {
  setOutputPath(outputPath)

  const taskList = [
    {
      title: 'Creating Delayed suspense delayed page',
      task: async () => {
        const createPage = createBuilder('yarn cedar g page')
        await createPage('delayed')

        await applyCodemod(
          'delayedPage.js',
          fullPath('web/src/pages/DelayedPage/DelayedPage'),
        )
      },
    },
    {
      title: 'Enable streaming-ssr experiment',
      task: async () => {
        const setupExperiment = createBuilder(
          'yarn cedar experimental setup-streaming-ssr',
        )
        await setupExperiment('--force')
      },
    },
  ]

  return taskList
}
