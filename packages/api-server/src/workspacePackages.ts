import fs from 'node:fs'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export async function workspacePackages() {
  const cedarPaths = getPaths()
  const packagesDir = path.join(cedarPaths.base, 'packages')

  const packages: string[] = []

  try {
    const rootPackageJsonPath = path.join(cedarPaths.base, 'package.json')

    const rootPackageJson = JSON.parse(
      fs.readFileSync(rootPackageJsonPath, 'utf8'),
    )
    const hasPackageJsonWorkspaces =
      Array.isArray(rootPackageJson.workspaces) &&
      rootPackageJson.workspaces.some((w: string) => w.startsWith('packages/'))

    // Optimization to return early if no workspace packages are defined
    if (!hasPackageJsonWorkspaces || !fs.existsSync(packagesDir)) {
      return []
    }

    const globPattern = path.join(packagesDir, '*').replaceAll('\\', '/')
    const packageDirs = await Array.fromAsync(fs.promises.glob(globPattern))

    const apiPackageJsonPath = path.join(cedarPaths.api.base, 'package.json')

    // Look for 'workspace:*' dependencies in the API package.json
    // No need to watch *all* workspace packages, only need to watch those that
    // the api workspace actually depends on
    const apiPackageJson = JSON.parse(
      fs.readFileSync(apiPackageJsonPath, 'utf8'),
    )
    const deps = {
      ...(apiPackageJson.dependencies ?? {}),
      ...(apiPackageJson.devDependencies ?? {}),
      ...(apiPackageJson.peerDependencies ?? {}),
    }

    const workspaceDepNames = new Set<string>()

    for (const [name, version] of Object.entries(deps)) {
      if (String(version).startsWith('workspace:')) {
        workspaceDepNames.add(name)
      }
    }

    for (const packageDir of packageDirs) {
      const packageJsonPath = path.join(packageDir, 'package.json')

      if (!fs.existsSync(packageJsonPath)) {
        continue
      }

      const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

      if (workspaceDepNames.has(pkgJson.name)) {
        const srcDir = path.join(packageDir, 'src')

        if (fs.existsSync(srcDir)) {
          packages.push(path.join(srcDir, '**', '*'))
        } else {
          packages.push(path.join(packageDir, '**', '*'))
        }
      }
    }
  } catch {
    // If anything goes wrong while determining workspace packages, ignore them
    // all
  }

  return packages
}
