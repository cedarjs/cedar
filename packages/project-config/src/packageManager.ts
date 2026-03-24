import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from './paths.js'

export type PackageManager = 'yarn' | 'npm' | 'pnpm'

let packageManagerCache: PackageManager | undefined

/**
 * Returns the package manager used by the Cedar project. Falls back to 'yarn'
 * if we can't determine what package managager the project uses
 */
export function getPackageManager(): PackageManager {
  if (packageManagerCache) {
    return packageManagerCache
  }

  const base = getPaths().base

  if (fs.existsSync(path.join(base, 'yarn.lock'))) {
    packageManagerCache = 'yarn'
    return packageManagerCache
  }

  if (fs.existsSync(path.join(base, 'pnpm-lock.yaml'))) {
    packageManagerCache = 'pnpm'
    return packageManagerCache
  }

  if (fs.existsSync(path.join(base, 'package-lock.json'))) {
    packageManagerCache = 'npm'
    return packageManagerCache
  }

  return 'yarn'
}

export function resetPackageManagerCache() {
  packageManagerCache = undefined
}

export function prettyPrintCedarCommand(args: string[]): string {
  const packageManager = getPackageManager()

  const packageManagerBin = packageManager === 'npm' ? 'npx' : packageManager

  return `${packageManagerBin} cedar ${args.join(' ')}`
}
