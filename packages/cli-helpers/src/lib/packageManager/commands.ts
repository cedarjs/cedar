import type { PackageManager } from '@cedarjs/project-config'

export interface PackageManagerCommand {
  command: string
  args: string[]
}

export interface PackageOptions {
  dev?: boolean
}

export function installPackages(): PackageManagerCommand {
  return { command: 'yarn', args: ['install'] }
}

export function installPackagesFor(
  packageManager: PackageManager,
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return { command: 'yarn', args: ['install'] }
    case 'npm':
      return { command: 'npm', args: ['install'] }
    case 'pnpm':
      return { command: 'pnpm', args: ['install'] }
    default:
      return { command: 'yarn', args: ['install'] }
  }
}

export function addRootPackages(
  packages: string[],
  packageManager: PackageManager,
  opts: PackageOptions = {},
): PackageManagerCommand {
  const args: string[] = []

  switch (packageManager) {
    case 'yarn':
      args.push('add')
      if (opts.dev) {
        args.push('-D')
      }
      args.push(...packages)
      return { command: 'yarn', args }
    case 'npm':
      args.push('install')
      if (opts.dev) {
        args.push('-D')
      }
      args.push(...packages)
      return { command: 'npm', args }
    case 'pnpm':
      args.push('add')
      if (opts.dev) {
        args.push('-D')
      }
      args.push(...packages)
      return { command: 'pnpm', args }
    default:
      return { command: 'yarn', args: ['add', ...packages] }
  }
}

export function addWorkspacePackages(
  workspace: string,
  packages: string[],
  packageManager: PackageManager,
  opts: PackageOptions = {},
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return {
        command: 'yarn',
        args: [
          'workspace',
          workspace,
          'add',
          ...(opts.dev ? ['-D'] : []),
          ...packages,
        ],
      }
    case 'npm':
      return {
        command: 'npm',
        args: [
          'install',
          ...(opts.dev ? ['-D'] : []),
          ...packages,
          '-w',
          workspace,
        ],
      }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: [
          'add',
          ...(opts.dev ? ['-D'] : []),
          ...packages,
          '--filter',
          workspace,
        ],
      }
    default:
      return {
        command: 'yarn',
        args: ['workspace', workspace, 'add', ...packages],
      }
  }
}

export function removeWorkspacePackages(
  workspace: string,
  packages: string[],
  packageManager: PackageManager,
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return {
        command: 'yarn',
        args: ['workspace', workspace, 'remove', ...packages],
      }
    case 'npm':
      return {
        command: 'npm',
        args: ['uninstall', ...packages, '-w', workspace],
      }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['remove', ...packages, '--filter', workspace],
      }
    default:
      return {
        command: 'yarn',
        args: ['workspace', workspace, 'remove', ...packages],
      }
  }
}

export function runScript(
  script: string,
  packageManager: PackageManager,
  args: string[] = [],
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return { command: 'yarn', args: [script, ...args] }
    case 'npm':
      return { command: 'npm', args: ['run', script, '--', ...args] }
    case 'pnpm':
      return { command: 'pnpm', args: [script, ...args] }
    default:
      return { command: 'yarn', args: [script, ...args] }
  }
}

export function runWorkspaceScript(
  workspace: string,
  script: string,
  packageManager: PackageManager,
  args: string[] = [],
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return {
        command: 'yarn',
        args: ['workspace', workspace, script, ...args],
      }
    case 'npm':
      return {
        command: 'npm',
        args: ['run', script, '-w', workspace, '--', ...args],
      }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: [script, '--filter', workspace, ...args],
      }
    default:
      return {
        command: 'yarn',
        args: ['workspace', workspace, script, ...args],
      }
  }
}

export function runBin(
  bin: string,
  args: string[] = [],
  packageManager: PackageManager,
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return { command: 'yarn', args: [bin, ...args] }
    case 'npm':
      return { command: 'npx', args: [bin, ...args] }
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', bin, ...args] }
    default:
      return { command: 'yarn', args: [bin, ...args] }
  }
}

export function runWorkspaceBin(
  workspace: string,
  bin: string,
  args: string[] = [],
  packageManager: PackageManager,
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return {
        command: 'yarn',
        args: ['workspace', workspace, bin, ...args],
      }
    case 'npm':
      // npm doesn't have a direct equivalent for 'npx -w <workspace> <bin>' for local binaries in node_modules/.bin
      // but we can use npm exec
      return {
        command: 'npm',
        args: ['exec', '-w', workspace, '--', bin, ...args],
      }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['exec', '--filter', workspace, bin, ...args],
      }
    default:
      return {
        command: 'yarn',
        args: ['workspace', workspace, bin, ...args],
      }
  }
}

export function dlx(
  command: string,
  args: string[] = [],
  packageManager: PackageManager,
): PackageManagerCommand {
  switch (packageManager) {
    case 'yarn':
      return { command: 'yarn', args: ['dlx', command, ...args] }
    case 'npm':
      return { command: 'npx', args: [command, ...args] }
    case 'pnpm':
      return { command: 'pnpm', args: ['dlx', command, ...args] }
    default:
      return { command: 'yarn', args: ['dlx', command, ...args] }
  }
}

export function dedupe(
  packageManager: PackageManager,
): PackageManagerCommand | null {
  if (packageManager === 'yarn') {
    return { command: 'yarn', args: ['dedupe'] }
  }
  return null
}
