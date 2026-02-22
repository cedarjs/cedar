import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'

import concurrently from 'concurrently'

import { importStatementPath } from '@cedarjs/project-config'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../../lib/index.js'

export async function buildPackagesTask(task, nonApiWebWorkspaces) {
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
            w.split('/').at(-1),
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

  // Capture concurrently's output so we can include it in error messages.
  // By default concurrently writes to process.stdout, but Listr's renderer
  // takes control of the terminal and redraws over any direct stdout writes,
  // effectively swallowing compilation errors.
  const outputChunks = []
  const outputStream = new Writable({
    write(chunk, _encoding, callback) {
      outputChunks.push(chunk.toString())
      callback()
    },
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
      outputStream,
    },
  )

  await result.catch((e) => {
    const capturedOutput = outputChunks.join('')

    // concurrently rejects with an array of CloseEvent objects (not an Error)
    // when one or more commands fail. Each CloseEvent has an `exitCode`, and a
    // few more properties.
    if (Array.isArray(e)) {
      const failed = e.filter((closeEvent) => closeEvent.exitCode !== 0)

      if (failed.length > 0) {
        const message = failed
          .map(
            (closeEvent) =>
              `"${closeEvent.command?.name ?? closeEvent.command?.command}" exited with code ${closeEvent.exitCode}`,
          )
          .join(', ')

        errorTelemetry(process.argv, `Error building packages: ${message}`)

        const errorLines = [`Building packages failed: ${message}`]

        if (capturedOutput.trim()) {
          errorLines.push('', capturedOutput.trim())
        }

        throw new Error(errorLines.join('\n'))
      }
    } else {
      errorTelemetry(process.argv, `Error building packages: ${e}`)

      if (capturedOutput.trim()) {
        const errorMessage = e instanceof Error ? e.message : String(e)
        throw new Error(errorMessage + '\n\n' + capturedOutput.trim())
      }

      throw e
    }
  })
}
