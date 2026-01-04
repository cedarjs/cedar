import fs from 'node:fs'
import path from 'node:path'

import concurrently from 'concurrently'

import { importStatementPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { exitWithError } from '../../lib/exit.js'
import { getPaths } from '../../lib/index.js'

export async function buildPackagesTask(nonApiWebWorkspaces) {
  const cedarPaths = getPaths()

  // fs.globSync requires forward slashes as path separators in patterns,
  // even on Windows.
  const globPattern = path.join(cedarPaths.packages, '*').replaceAll('\\', '/')

  // restWorkspaces can be ['packages/*'] or
  // ['@my-org/pkg-one', '@my-org/pkg-two', 'packages/pkg-three', etc]
  // We need to map that to filesystem paths
  const workspacePaths = nonApiWebWorkspaces.some((w) => w === 'packages/*')
    ? await Array.fromAsync(fs.promises.glob(globPattern))
    : nonApiWebWorkspaces.map((w) => {
        const workspacePath = path.join(
          cedarPaths.packages,
          w.split('/').at(-1),
        )

        if (!fs.existsSync(workspacePath)) {
          throw new Error(`Workspace not found: ${workspacePath}`)
        }

        return importStatementPath(workspacePath)
      })

  const { result } = concurrently(
    workspacePaths.map((workspacePath) => {
      return {
        command: `yarn build`,
        name: workspacePath.split('/').at(-1),
        cwd: workspacePath,
      }
    }),
    {
      prefix: '{name} |',
      timestampFormat: 'HH:mm:ss',
    },
  )

  await result.catch((e) => {
    if (e?.message) {
      errorTelemetry(
        process.argv,
        `Error concurrently building sides: ${e.message}`,
      )
      exitWithError(e)
    }
  })
}
