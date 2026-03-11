import fs from 'node:fs'
import path from 'node:path'

import {
  getDbDir,
  getPaths,
  importStatementPath,
} from '@cedarjs/project-config'

async function workspacePackagesPaths() {
  const cedarPaths = getPaths()
  const packagesDir = path.join(cedarPaths.packages)

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
        packages.push(path.join(packageDir, 'dist'))
      }
    }
  } catch {
    // If anything goes wrong while determining workspace packages, ignore them
    // all
  }

  return packages
}

async function apiIgnorePaths() {
  const cedarPaths = getPaths()

  const dbDir = await getDbDir(cedarPaths.api.prismaConfig)

  if (dbDir === cedarPaths.api.base) {
    throw new Error(
      'Database directory cannot be the same as the API directory',
    )
  }

  const ignoredApiPaths = [
    // TODO: Is this still true?
    // use this, because using cedarPaths.api.dist seems to not ignore on first
    // build
    'api/dist',
    cedarPaths.api.types,
    dbDir,
  ]

  return ignoredApiPaths
}

export async function getIgnoreFunction() {
  const cedarPaths = getPaths()
  // The file with a detected change comes through as a unix path, even on
  // windows. So we need to convert all paths to unix-style paths to ensure
  // matches. Plus, chokidar needs unix-style `/` path separators for globs even
  // on Windows, which is exactly what `importStatementPath()` converts paths to
  const ignoredApiPaths = await apiIgnorePaths()

  const ignoredExtensions = [
    '.DS_Store',
    '.db',
    '.sqlite',
    '-journal',
    '.test.js',
    '.test.ts',
    '.scenarios.ts',
    '.scenarios.js',
    '.d.ts',
    '.log',
  ]

  return (file: string) => {
    if (file.includes('node_modules')) {
      return true
    }

    if (ignoredExtensions.some((ext) => file.endsWith(ext))) {
      return true
    }

    // Ignore package source files since the api server is using the built files
    // in the dist directory
    if (
      file.includes(importStatementPath(cedarPaths.packages)) &&
      file.includes('/src/')
    ) {
      return true
    }

    if (ignoredApiPaths.some((ignoredPath) => file.includes(ignoredPath))) {
      return true
    }

    return false
  }
}

export async function pathsToWatch() {
  const cedarPaths = getPaths()
  const watchPaths = [cedarPaths.api.src, ...(await workspacePackagesPaths())]

  // For glob paths, which  `workspacePackages()` above might return, chokidar
  // needs unix-style `/` path separators also on Windows, which is exactly what
  // `importStatementPath()` provides.
  return watchPaths.map((p) => importStatementPath(p))
}
