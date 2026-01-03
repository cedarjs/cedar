import fs from 'node:fs'
import path from 'node:path'

import type { ListrTask } from 'listr2'

import {
  getWebTasks,
  getApiTasks,
  addModel,
  type HighLevelTask,
  type CommonTaskOptions,
} from './base-tasks.mjs'
import {
  applyCodemod,
  fullPath,
  getExecaOptions,
  setOutputPath,
  exec,
  createBuilder,
} from './util.mjs'

interface WebTasksOptions {
  linkWithLatestFwBuild?: boolean
}

function mapToListrTask(
  t: HighLevelTask,
  options: CommonTaskOptions,
): ListrTask {
  const enabled =
    typeof t.enabled === 'function' ? t.enabled(options) : t.enabled

  return {
    title: t.title,
    task: async (_ctx, task) => {
      if (t.tasksGetter) {
        const subtasks = await t.tasksGetter(options)
        return task.newListr(subtasks)
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
  { linkWithLatestFwBuild }: WebTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = { outputPath, linkWithLatestFwBuild }

  const tasks = getWebTasks(options)
  return tasks.map((t) => mapToListrTask(t, options))
}

interface ApiTasksOptions {
  linkWithLatestFwBuild?: boolean
}

export async function apiTasks(
  outputPath: string,
  { linkWithLatestFwBuild }: ApiTasksOptions,
): Promise<ListrTask[]> {
  setOutputPath(outputPath)
  const options: CommonTaskOptions = { outputPath, linkWithLatestFwBuild }

  const tasks = getApiTasks(options)
  return tasks.map((t) => mapToListrTask(t, options))
}

export async function streamingTasks(outputPath: string): Promise<ListrTask[]> {
  return [
    {
      title: 'Creating Delayed suspense delayed page',
      task: async () => {
        await createBuilder('yarn cedar g page')('delayed')
        return applyCodemod(
          'delayedPage.js',
          fullPath('web/src/pages/DelayedPage/DelayedPage'),
        )
      },
    },
    {
      title: 'Enable streaming-ssr experiment',
      task: async () => {
        await createBuilder('yarn cedar experimental setup-streaming-ssr')(
          '--force',
        )
      },
    },
  ]
}

export async function fragmentsTasks(outputPath: string): Promise<ListrTask[]> {
  const options: CommonTaskOptions = { outputPath }
  return [
    {
      title: 'Enable fragments',
      task: async () => {
        const tomlPath = path.join(outputPath, 'redwood.toml')
        const content = fs.readFileSync(tomlPath, 'utf-8')
        fs.writeFileSync(
          tomlPath,
          content + '\n[graphql]\n  fragments = true\n',
        )
      },
    },
    {
      title: 'Adding produce and stall models',
      task: async () => {
        const { produce, stall } = await import('./codemods/models.mjs')
        await addModel(outputPath, produce)
        await addModel(outputPath, stall)
        return exec(
          'yarn cedar prisma migrate dev --name create_produce_stall',
          [],
          getExecaOptions(outputPath),
        )
      },
    },
  ]
}
