import fs from 'node:fs'
import path from 'node:path'

import type { PackageManager } from '@cedarjs/project-config/packageManager'

export type AddWorkspaceDirResult = 'exists' | 'added'

export function addWorkspaceDir(
  baseDir: string,
  packagePath: string,
  pm: PackageManager,
): AddWorkspaceDirResult {
  if (pm === 'pnpm') {
    return addPnpmWorkspaceDir(baseDir, packagePath)
  }

  return addPackageJsonWorkspaceDir(baseDir, packagePath)
}

function addPnpmWorkspaceDir(
  baseDir: string,
  packagePath: string,
): AddWorkspaceDirResult {
  const yamlPath = path.join(baseDir, 'pnpm-workspace.yaml')
  if (!fs.existsSync(yamlPath)) {
    throw new Error('Invalid workspace config in ' + yamlPath)
  }

  const content = fs.readFileSync(yamlPath, 'utf8')
  const packageEntry = `  - ${packagePath}`

  if (content.includes(packageEntry)) {
    return 'exists'
  }

  const match = content.match(/^(packages:[\s\S]*?)(?=^\w|(?![\s\S]))/m)
  if (!match) {
    throw new Error('Invalid workspace config in ' + yamlPath)
  }

  const packagesSection = match[1]
  const lines = packagesSection.split('\n')
  const lastPackageLine = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.trimStart().startsWith('- '))
    .pop()

  if (!lastPackageLine) {
    throw new Error('Invalid workspace config in ' + yamlPath)
  }

  const insertAfter = lastPackageLine.i
  lines.splice(insertAfter + 1, 0, packageEntry)
  const updatedContent = content.replace(packagesSection, lines.join('\n'))

  fs.writeFileSync(yamlPath, updatedContent, 'utf8')
  return 'added'
}

function addPackageJsonWorkspaceDir(
  baseDir: string,
  packagePath: string,
): AddWorkspaceDirResult {
  const pkgPath = path.join(baseDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  if (!Array.isArray(pkg.workspaces)) {
    throw new Error('Invalid workspace config in ' + pkgPath)
  }

  const hasWildcardPackagesWorkspace = pkg.workspaces.includes('packages/*')
  const hasNamedPackagesWorkspace = pkg.workspaces.includes(packagePath)
  const hasOtherNamedPackages = pkg.workspaces.some(
    (workspace: string) =>
      workspace.startsWith('packages/') && workspace !== packagePath,
  )

  if (hasWildcardPackagesWorkspace || hasNamedPackagesWorkspace) {
    return 'exists'
  }

  if (hasOtherNamedPackages) {
    pkg.workspaces.push(packagePath)
  } else {
    pkg.workspaces.push('packages/*')
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  return 'added'
}
