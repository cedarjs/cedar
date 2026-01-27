import execa from 'execa'
import { Listr } from 'listr2'

import { setOutputPath, webTasksList, apiTasksList } from './base-tasks.mts'
import { getExecaOptions, getCfwBin } from './util.mts'

interface WebTasksOptions {
  linkWithLatestFwBuild: boolean
  verbose: boolean
}

export async function webTasks(
  outputPath: string,
  { linkWithLatestFwBuild, verbose }: WebTasksOptions,
) {
  setOutputPath(outputPath)

  const baseTasks = webTasksList()

  // Some tasks returns an array of tasks, those needs to be wrapped in a Listr
  // instance
  const wrappedTasks = baseTasks.map((taskDef) => {
    return {
      title: taskDef.title,
      task: taskDef.isNested
        ? async () => new Listr(await taskDef.task())
        : taskDef.task,
    }
  })

  return new Listr(
    [
      ...wrappedTasks,

      // ====== NOTE: cfw needs this workaround for tailwind =======
      // Setup tailwind in a linked project, due to cfw we install deps manually
      {
        title: 'Install tailwind dependencies',
        // @NOTE: use cfw, because calling the copy function doesn't seem to work here
        task: () =>
          execa(
            'yarn workspace web add -D postcss postcss-loader tailwindcss autoprefixer prettier-plugin-tailwindcss@^0.5.12',
            [],
            getExecaOptions(outputPath),
          ),
        enabled: () => linkWithLatestFwBuild,
      },
      {
        title: '[link] Copy local framework files again',
        // @NOTE: use cfw, because calling the copy function doesn't seem to work here
        task: () =>
          execa(
            `yarn ${getCfwBin(outputPath)} project:copy`,
            [],
            getExecaOptions(outputPath),
          ),
        enabled: () => linkWithLatestFwBuild,
      },
      // =========
      {
        title: 'Adding Tailwind',
        task: () => {
          return execa(
            'yarn cedar setup ui tailwindcss',
            ['--force', linkWithLatestFwBuild && '--no-install'].filter(
              (i: string | boolean): i is string => Boolean(i),
            ),
            getExecaOptions(outputPath),
          )
        },
      },
    ],
    {
      exitOnError: true,
      renderer: verbose ? 'verbose' : 'default',
    },
  )
}

interface ApiTasksOptions {
  verbose: boolean
  linkWithLatestFwBuild: boolean
  esmProject: boolean
}

export async function apiTasks(
  outputPath: string,
  { verbose, linkWithLatestFwBuild, esmProject }: ApiTasksOptions,
) {
  setOutputPath(outputPath)

  const baseTasks = apiTasksList({
    dbAuth: 'canary',
    linkWithLatestFwBuild,
    esmProject,
  })

  // Some tasks returns an array of tasks, those needs to be wrapped in a Listr
  // instance
  const wrappedTasks = baseTasks.map((taskDef) => {
    return {
      title: taskDef.title,
      task: taskDef.isNested
        ? async () => new Listr(await taskDef.task())
        : taskDef.task,
    }
  })

  return new Listr(wrappedTasks, {
    exitOnError: true,
    renderer: verbose ? 'verbose' : 'default',
  })
}
