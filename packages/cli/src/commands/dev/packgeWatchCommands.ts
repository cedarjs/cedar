import fs from 'node:fs'
import path from 'node:path'

import { importStatementPath } from '@cedarjs/project-config'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'

interface WatchPackageCommand {
  command: string
  name: string
  cwd: string
}

export async function getPackageWatchCommands(
  packageWorkspaces: string[],
): Promise<WatchPackageCommand[]> {
  const cedarPaths = getPaths()
  const globPattern = path.join(cedarPaths.packages, '*').replaceAll('\\', '/')

  // Map workspace names to filesystem paths
  // packageWorkspaces can be ['packages/*'] or
  // ['@my-org/pkg-one', '@my-org/pkg-two', 'packages/pkg-three', etc]
  const workspacePaths = packageWorkspaces.some((w) => w === 'packages/*')
    ? await Array.fromAsync(fs.promises.glob(globPattern))
    : packageWorkspaces.map((w) => {
        const packageFolderName = w.split('/').at(-1)

        if (!packageFolderName) {
          throw new Error(`Invalid package workspace: ${w}`)
        }

        const workspacePath = path.join(cedarPaths.packages, packageFolderName)

        if (!fs.existsSync(workspacePath)) {
          throw new Error(`Workspace not found: ${workspacePath}`)
        }

        return importStatementPath(workspacePath)
      })

  // Filter to only packages that have a watch script
  const watchablePackages: string[] = []
  const packagesWithoutWatch: (string | undefined)[] = []

  for (const workspacePath of workspacePaths) {
    const packageJsonPath = path.join(workspacePath, 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
      continue
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const packageName = workspacePath.split('/').at(-1)

    if (packageJson.scripts?.watch) {
      watchablePackages.push(workspacePath)
    } else {
      packagesWithoutWatch.push(packageName)
    }
  }

  // Log warnings for packages without watch scripts
  if (packagesWithoutWatch.length > 0) {
    console.warn(
      `${c.warning('Warning: ')} The following package(s) do not have a ` +
        '"watch" script and will be skipped: ' +
        packagesWithoutWatch.join(', '),
    )
  }

  return watchablePackages.map((workspacePath) => {
    const name = workspacePath.split('/').at(-1)

    if (!name) {
      throw new Error(`Invalid package path: ${workspacePath}`)
    }

    return {
      command: 'yarn watch',
      name,
      cwd: workspacePath,
    }
  })
}
