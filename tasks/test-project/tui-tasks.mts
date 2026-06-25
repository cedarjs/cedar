import type { Options as ExecaOptions } from 'execa'

import { webTasksList } from './base-tasks.mts'
import { setOutputPath } from './paths.mts'
import type { PackageManager } from './typing.mts'
import type { TuiTaskList } from './typing.mts'
import { getExecaOptions as utilGetExecaOptions, exec } from './util.mts'

function getExecaOptions(cwd: string): ExecaOptions {
  return { ...utilGetExecaOptions(cwd), stdio: 'pipe' as const }
}

export async function webTasks(
  outputPath: string,
  live = false,
  packageManager: PackageManager = 'yarn',
) {
  setOutputPath(outputPath)

  const cedarBin = packageManager === 'npm' ? 'npx' : packageManager
  const execaOptions = getExecaOptions(outputPath)

  const tuiTaskList: TuiTaskList = [
    ...webTasksList(live, packageManager),
    {
      title: 'Adding Tailwind',
      task: async () => {
        await exec(
          `${cedarBin} cedar setup ui tailwindcss --force`,
          [],
          execaOptions,
        )
      },
    },
  ]

  return tuiTaskList
}
