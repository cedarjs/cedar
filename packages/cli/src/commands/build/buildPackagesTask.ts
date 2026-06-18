import fs from 'node:fs'
import path from 'node:path'

import { runScript } from '@cedarjs/cli-helpers/packageManager/exec'
import { importStatementPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../../lib/index.js'

export async function buildPackagesTask(
  task: {
    skip: (msg: string) => void
    newListr: (...args: unknown[]) => unknown
  },
  nonApiWebWorkspaces: string[],
) {
  const cedarPaths = getPaths()

  const globPattern = path.join(cedarPaths.packages, '*').replaceAll('\\', '/')

  // nonApiWebWorkspaces can be ['packages/*'] or
  // ['@my-org/pkg-one', '@my-org/pkg-two', 'packages/pkg-three', etc]
  // We need to map that to filesystem paths
  const workspacePaths = nonApiWebWorkspaces.some((w) => w === 'packages/*')
    ? await Array.fromAsync(fs.promises.glob(globPattern))
    : nonApiWebWorkspaces
        .map((w) => {
          const workspacePath = path.join(
            cedarPaths.packages,
            w.split('/').at(-1) as string,
          )

          if (!fs.existsSync(workspacePath)) {
            return ''
          }

          return importStatementPath(workspacePath)
        })
        .filter(Boolean)

  if (!workspacePaths.length) {
    task.skip('No packages to build at ' + nonApiWebWorkspaces.join(', '))
    return
  }

  return task.newListr(
    workspacePaths.map((workspacePath) => {
      const name = workspacePath.split('/').at(-1)

      return {
        title: name,
        task: async () => {
          try {
            await runScript('build', [], { cwd: workspacePath })
          } catch (e: unknown) {
            const err = e as { message: string; stderr?: string }
            errorTelemetry(
              process.argv,
              `Error building package "${name}": ${err.message}`,
            )

            // execa includes stderr in the error message, which contains
            // the actual compilation errors (e.g. TypeScript errors)
            throw new Error(
              `Building "${name}" failed\n\n${err.stderr || err.message}`,
            )
          }
        },
      }
    }),
    { concurrent: true, rendererOptions: { collapseSubtasks: false } },
  )
}
