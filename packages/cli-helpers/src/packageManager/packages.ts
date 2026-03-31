import execa from 'execa'
import type { Options as ExecaOptions } from 'execa'

import { getPackageManager } from '@cedarjs/project-config/packageManager'

type AddOptions = ExecaOptions & { dev?: boolean }

/**
 * Add packages to the project root.
 *
 * - yarn:  `yarn add [-D] <packages>`
 * - npm:   `npm install [-D] <packages>`
 * - pnpm:  `pnpm add [-D] <packages>`
 */
export function addRootPackages(packages: string[], options?: AddOptions) {
  const pm = getPackageManager()
  const { dev, ...execaOptions } = options ?? {}
  const addCmd = pm === 'npm' ? 'install' : 'add'
  const devFlag = dev ? ['-D'] : []

  return execa(pm, [addCmd, ...devFlag, ...packages], execaOptions)
}

/**
 * Add packages to a specific workspace.
 *
 * - yarn:  `yarn workspace <workspace> add [-D] <packages>`
 * - npm:   `npm install [-D] <packages> -w <workspace>`
 * - pnpm:  `pnpm add [-D] <packages> --filter <workspace>`
 */
export function addWorkspacePackages(
  workspace: string,
  packages: string[],
  options?: AddOptions,
) {
  const pm = getPackageManager()
  const { dev, ...execaOptions } = options ?? {}
  const devFlag = dev ? ['-D'] : []

  if (pm === 'yarn') {
    return execa(
      pm,
      ['workspace', workspace, 'add', ...devFlag, ...packages],
      execaOptions,
    )
  }

  if (pm === 'npm') {
    return execa(
      pm,
      ['install', ...devFlag, ...packages, '-w', workspace],
      execaOptions,
    )
  }

  // pnpm
  return execa(
    pm,
    ['add', ...devFlag, ...packages, '--filter', workspace],
    execaOptions,
  )
}

/**
 * Remove packages from a specific workspace.
 *
 * - yarn:  `yarn workspace <workspace> remove <packages>`
 * - npm:   `npm uninstall <packages> -w <workspace>`
 * - pnpm:  `pnpm remove <packages> --filter <workspace>`
 */
export function removeWorkspacePackages(
  workspace: string,
  packages: string[],
  options?: ExecaOptions,
) {
  const pm = getPackageManager()

  if (pm === 'yarn') {
    return execa(pm, ['workspace', workspace, 'remove', ...packages], options)
  }

  if (pm === 'npm') {
    return execa(pm, ['uninstall', ...packages, '-w', workspace], options)
  }

  // pnpm
  return execa(pm, ['remove', ...packages, '--filter', workspace], options)
}

/**
 * Install all project dependencies.
 *
 * - yarn:  `yarn install`
 * - npm:   `npm install`
 * - pnpm:  `pnpm install`
 */
export function installPackages(options?: ExecaOptions) {
  const pm = getPackageManager()
  return execa(pm, ['install'], options)
}
