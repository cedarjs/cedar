import execa from 'execa'
import type { Options as ExecaOptions } from 'execa'

import type { PackageManagerCommand } from './commands.js'
import {
  installPackagesFor,
  addWorkspacePackages,
  addRootPackages,
} from './commands.js'
import { getPackageManager } from './config.js'

export async function runPackageManagerCommand(
  pmCommand: PackageManagerCommand,
  options?: ExecaOptions,
) {
  return execa(pmCommand.command, pmCommand.args, options)
}

export function installPackagesTask(cwd?: string) {
  const packageManager = getPackageManager(cwd)
  const pmCommand = installPackagesFor(packageManager)

  return {
    title: `Installing packages using ${packageManager}...`,
    task: async () => {
      await runPackageManagerCommand(pmCommand, { cwd })
    },
  }
}

export function addWorkspacePackagesTask(
  workspace: string,
  packages: string[],
  dev = false,
  cwd?: string,
) {
  const packageManager = getPackageManager(cwd)
  const pmCommand = addWorkspacePackages(workspace, packages, packageManager, {
    dev,
  })

  return {
    title: `Adding packages to ${workspace}...`,
    task: async () => {
      await runPackageManagerCommand(pmCommand, { cwd })
    },
  }
}

export function addRootPackagesTask(
  packages: string[],
  dev = false,
  cwd?: string,
) {
  const packageManager = getPackageManager(cwd)
  const pmCommand = addRootPackages(packages, packageManager, { dev })

  return {
    title: 'Adding packages to root...',
    task: async () => {
      await runPackageManagerCommand(pmCommand, { cwd })
    },
  }
}
