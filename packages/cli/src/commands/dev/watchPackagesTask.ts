import fs from 'node:fs'
import path from 'node:path'

import concurrently from 'concurrently'

import { importStatementPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { exitWithError } from '../../lib/exit.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../../lib/index.js'

export async function watchPackagesTask(packageWorkspaces: string[]) {
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
  const watchablePackages = []
  const packagesWithoutWatch = []

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
      c.warning('Warning: ') +
        `The following package(s) do not have a "watch" script and will be skipped: ${packagesWithoutWatch.join(', ')}`,
    )
  }

  // Return null if no watchable packages found
  if (watchablePackages.length === 0) {
    return null
  }

  // Use concurrently to run yarn watch in each package directory
  const { result } = concurrently(
    watchablePackages.map((workspacePath) => ({
      command: 'yarn watch',
      name: workspacePath.split('/').at(-1),
      cwd: workspacePath,
    })),
    {
      prefix: '{name} |',
      timestampFormat: 'HH:mm:ss',
    },
  )

  return result.catch((e) => {
    if (e?.message) {
      errorTelemetry(process.argv, `Error watching packages: ${e.message}`)
      exitWithError(e)
    }
  })
}
