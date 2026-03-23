import type { PackageManager } from '@cedarjs/project-config'

import {
  addRootPackages,
  addWorkspacePackages,
  dlx,
  removeWorkspacePackages,
  runBin,
  runScript,
  runWorkspaceBin,
  runWorkspaceScript,
} from './commands.js'
import type { PackageOptions } from './commands.js'

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.join(' ')}`
}

export function formatInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'yarn':
      return 'yarn install'
    case 'npm':
      return 'npm install'
    case 'pnpm':
      return 'pnpm install'
    default:
      return 'yarn install'
  }
}

export function formatAddRootPackagesCommand(
  packages: string[],
  packageManager: PackageManager,
  opts: PackageOptions = {},
): string {
  const { command, args } = addRootPackages(packages, packageManager, opts)
  return formatCommand(command, args)
}

export function formatAddWorkspacePackagesCommand(
  workspace: string,
  packages: string[],
  packageManager: PackageManager,
  opts: PackageOptions = {},
): string {
  const { command, args } = addWorkspacePackages(
    workspace,
    packages,
    packageManager,
    opts,
  )
  return formatCommand(command, args)
}

export function formatRemoveWorkspacePackagesCommand(
  workspace: string,
  packages: string[],
  packageManager: PackageManager,
): string {
  const { command, args } = removeWorkspacePackages(
    workspace,
    packages,
    packageManager,
  )
  return formatCommand(command, args)
}

export function formatRunScriptCommand(
  script: string,
  packageManager: PackageManager,
  args: string[] = [],
): string {
  const { command, args: commandArgs } = runScript(script, packageManager, args)
  return formatCommand(command, commandArgs)
}

export function formatRunWorkspaceScriptCommand(
  workspace: string,
  script: string,
  packageManager: PackageManager,
  args: string[] = [],
): string {
  const { command, args: commandArgs } = runWorkspaceScript(
    workspace,
    script,
    packageManager,
    args,
  )
  return formatCommand(command, commandArgs)
}

export function formatRunBinCommand(
  bin: string,
  args: string[] = [],
  packageManager: PackageManager,
): string {
  const { command, args: commandArgs } = runBin(bin, args, packageManager)
  return formatCommand(command, commandArgs)
}

export function formatRunWorkspaceBinCommand(
  workspace: string,
  bin: string,
  args: string[] = [],
  packageManager: PackageManager,
): string {
  const { command, args: commandArgs } = runWorkspaceBin(
    workspace,
    bin,
    args,
    packageManager,
  )
  return formatCommand(command, commandArgs)
}

export function formatDlxCommand(
  command: string,
  args: string[] = [],
  packageManager: PackageManager,
): string {
  const { command: dlxCommand, args: dlxArgs } = dlx(
    command,
    args,
    packageManager,
  )
  return formatCommand(dlxCommand, dlxArgs)
}

/**
 * Formats a generic cedar command.
 * e.g. "yarn cedar g page home" -> "npm cedar g page home"
 */
export function formatCedarCommand(
  args: string[],
  packageManager: PackageManager,
): string {
  return formatRunScriptCommand('cedar', packageManager, args)
}
