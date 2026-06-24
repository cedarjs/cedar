import fs from 'node:fs'
import path from 'node:path'

import { getPackageManager } from './packageManager.js'

export function getNonApiWebWorkspaces(baseDir: string): string[] {
  const pm = getPackageManager()
  const workspaces =
    pm === 'pnpm'
      ? readPnpmWorkspaces(baseDir)
      : readPackageJsonWorkspaces(baseDir)

  return workspaces.filter((w) => w !== 'api' && w !== 'web')
}

function readPackageJsonWorkspaces(baseDir: string): string[] {
  const pkgPath = path.join(baseDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return []
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return Array.isArray(pkg.workspaces) ? pkg.workspaces : []
  } catch {
    return []
  }
}

function readPnpmWorkspaces(baseDir: string): string[] {
  const yamlPath = path.join(baseDir, 'pnpm-workspace.yaml')
  if (!fs.existsSync(yamlPath)) {
    return []
  }

  try {
    const content = fs.readFileSync(yamlPath, 'utf8')
    const match = content.match(/^packages:\n([\s\S]*?)(?=^\w|\Z)/m)
    if (!match) {
      return []
    }

    return match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
