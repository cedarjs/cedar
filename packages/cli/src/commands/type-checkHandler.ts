import path from 'node:path'

import concurrently from 'concurrently'
import execa from 'execa'
import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - No types for .js files
import { generatePrismaClient } from '../lib/generatePrismaClient.js'
// @ts-expect-error - No types for .js files
import { getPaths } from '../lib/index.js'

interface TypeCheckOptions {
  sides: string[]
  verbose: boolean
  prisma: boolean
  generate: boolean
}

export const handler = async ({
  sides,
  verbose,
  prisma,
  generate,
}: TypeCheckOptions) => {
  recordTelemetryAttributes({
    command: 'type-check',
    sides: JSON.stringify(sides),
    verbose,
    prisma,
    generate,
  })

  /**
   * Check types for the project directory : [web, api]
   */
  const typeCheck = async () => {
    let conclusiveExitCode = 0

    const tscForAllSides = sides.map((side) => {
      const projectDir = path.join(getPaths().base, side)
      return {
        cwd: projectDir,
        command: `yarn tsc --noEmit --skipLibCheck`,
      }
    })

    const { result } = concurrently(tscForAllSides, {
      group: true,
      raw: true,
    })
    try {
      await result
    } catch (err: unknown) {
      if (Array.isArray(err)) {
        // Non-null exit codes
        const exitCodes = err
          .map((e: unknown) =>
            e instanceof Object &&
            'exitCode' in e &&
            typeof e.exitCode === 'number'
              ? e.exitCode
              : undefined,
          )
          .filter(
            (code: number | undefined): code is number =>
              code !== undefined && code !== null,
          )
        if (exitCodes.length > 0) {
          conclusiveExitCode = Math.max(...exitCodes)
        }
      }
    }

    return conclusiveExitCode
  }

  if (generate && prisma) {
    await generatePrismaClient({
      verbose: verbose,
    })
  }

  if (generate) {
    await new Listr(
      [
        {
          title: 'Generating types',
          task: () =>
            execa('yarn rw-gen', {
              shell: true,
              stdio: verbose ? 'inherit' : 'ignore',
            }),
        },
      ],
      {
        // @ts-expect-error - Listr renderer type issue
        renderer: verbose ? 'verbose' : 'default',
        rendererOptions: { collapseSubtasks: false },
      },
    ).run()
  }

  const exitCode = await typeCheck()
  if (exitCode > 0) {
    process.exitCode = exitCode
  }
}
