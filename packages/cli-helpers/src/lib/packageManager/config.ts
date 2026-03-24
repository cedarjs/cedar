import { getConfig } from '@cedarjs/project-config'
import type { PackageManager } from '@cedarjs/project-config'

/**
 * Returns the package manager used by the Cedar project.
 * Falls back to 'yarn' if not specified in cedar.toml.
 *
 * @param cwd Path to the Cedar project. Defaults to searching from current working directory.
 */
export function getPackageManager(cwd?: string): PackageManager {
  try {
    const config = getConfig(cwd)
    return config.packageManager || 'yarn'
  } catch {
    return 'yarn'
  }
}
