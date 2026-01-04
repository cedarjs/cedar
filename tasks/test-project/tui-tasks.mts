import type { ListrTask } from 'listr2'

import {
  getWebTasks,
  getApiTasks,
  type HighLevelTask,
  type CommonTaskOptions,
} from './base-tasks.mjs'
import { setOutputPath } from './util.mjs'

interface WebTasksOptions {
  linkWithLatestFwBuild?: boolean
}

function mapToTuiTask(t: HighLevelTask, options: CommonTaskOptions): ListrTask {
  const enabled =
    typeof t.enabled === 'function' ? t.enabled(options) : t.enabled

  return {
    title: t.title,
    task: async () => {
      if (t.tasksGetter) {
        return t.tasksGetter(options)
      }

      if (t.task) {
        return t.task(options)
      }

      throw new Error('Unexpected task')
    },
    enabled,
  }
}

export async function webTasks(
  outputPath: string,
  _options?: WebTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = {
    outputPath,
    isFixture: true,
    stdio: 'pipe',
  }

  const tasks = getWebTasks(options)
  return tasks.map((t) => mapToTuiTask(t, options))
}

interface ApiTasksOptions {
  linkWithLatestFwBuild?: boolean
  esmProject?: boolean
}

export async function apiTasks(
  outputPath: string,
  { linkWithLatestFwBuild = false, esmProject = false }: ApiTasksOptions = {},
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = {
    outputPath,
    isFixture: true,
    linkWithLatestFwBuild,
    esmProject,
    stdio: 'pipe',
  }

  const tasks = getApiTasks(options)
  return tasks.map((t) => mapToTuiTask(t, options))
}
