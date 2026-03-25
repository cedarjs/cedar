import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './paths.js'

export type PackageManager = 'yarn' | 'npm' | 'pnpm'

let packageManagerCache: PackageManager | undefined

/**
 * Returns the package manager used by the Cedar project. Falls back to 'yarn'
 * if we can't determine what package manager the project uses
 */
export function getPackageManager(): PackageManager {
  if (packageManagerCache) {
    return packageManagerCache
  }

  const base = getPaths().base
  packageManagerCache = 'yarn'

  /**
   * The `npm_config_user_agent` environment variable contains the user agent
   * string, which includes the package manager name (yarn, npm, or pnpm) and
   * version.
   *
   * Example values:
   *  - yarn/4.13.0 npm/? node/v24.13.1 darwin arm64
   *  - npm/11.8.0 node/v24.13.1 darwin arm64 workspaces/false
   */
  const envPackageManager = process.env.npm_config_user_agent
    ?.split(' ')[0]
    ?.split('/')[0]

  if (isPackageManager(envPackageManager)) {
    packageManagerCache = envPackageManager
  } else if (fs.existsSync(path.join(base, 'yarn.lock'))) {
    packageManagerCache = 'yarn'
  } else if (fs.existsSync(path.join(base, 'pnpm-lock.yaml'))) {
    packageManagerCache = 'pnpm'
  } else if (fs.existsSync(path.join(base, 'package-lock.json'))) {
    packageManagerCache = 'npm'
  }

  return packageManagerCache
}

function isPackageManager(pm?: string): pm is PackageManager {
  return pm === 'yarn' || pm === 'npm' || pm === 'pnpm'
}

export function resetPackageManagerCache() {
  packageManagerCache = undefined
}

/**
 * Gets a string suitable for displaying to the user when telling them to run a
 * Cedar bin command, like `yarn cedar upgrade` or
 * `yarn cedar generate page home /`.
 *
 * This is a duplicate of what's in `cli-helpers/packageManager`. Please
 * prefer the other one if you can. This one is only here for packages that
 * can't import cli-helpers.
 * TODO: Remove this one when we've fully moved to tree-shakable ESM sub-path
 * imports
 */
export function prettyPrintCedarCommand(args: string[]): string {
  const packageManager = getPackageManager()

  const packageManagerBin = packageManager === 'npm' ? 'npx' : packageManager

  return `${packageManagerBin} cedar ${args.join(' ')}`
}
