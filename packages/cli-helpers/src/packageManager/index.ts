import { getPackageManager } from '@cedarjs/project-config/packageManager'

export function workspacePackageVersion(): string {
  if (getPackageManager() === 'npm') {
    return '*'
  }

  return 'workspace:*'
}
