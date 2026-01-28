import type { Options as ExecaOptions } from 'execa'

import { setOutputPath, webTasksList } from './base-tasks.mts'
import type { TuiTaskList } from './typing.mts'
import { getExecaOptions as utilGetExecaOptions, exec } from './util.mts'

function getExecaOptions(cwd: string): ExecaOptions {
  return { ...utilGetExecaOptions(cwd), stdio: 'pipe' as const }
}

export async function webTasks(outputPath: string) {
  setOutputPath(outputPath)

  const execaOptions = getExecaOptions(outputPath)

  const tuiTaskList: TuiTaskList = [
    ...webTasksList(),
    {
      title: 'Adding Tailwind',
      task: async () => {
        await exec('yarn cedar setup ui tailwindcss', ['--force'], execaOptions)
      },
    },
  ]

  return tuiTaskList
}
