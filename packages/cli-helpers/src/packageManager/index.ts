import { getPackageManager } from '@cedarjs/project-config/packageManager'

export function workspacePackageSpecifier(): string {
  if (getPackageManager() === 'npm') {
    return '*'
  }

  return 'workspace:*'
}
