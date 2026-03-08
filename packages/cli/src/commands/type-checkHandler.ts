import path from 'path'

import concurrently from 'concurrently'
import execa from 'execa'
import { Listr } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import { generatePrismaClient } from '../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../lib/index.js'

type TypeCheckHandlerArgs = Record<string, unknown> & {
  sides?: string[]
  verbose?: boolean
  prisma?: boolean
  generate?: boolean
}

type ConcurrentlyError = {
  exitCode?: number
}

const isConcurrentlyErrorArray = (
  value: unknown,
): value is ConcurrentlyError[] => {
  return Array.isArray(value)
}

export const handler = async ({
  sides,
  verbose = false,
  prisma = true,
  generate = true,
}: TypeCheckHandlerArgs) => {
  const selectedSides = (Array.isArray(sides) ? sides : []).filter(
    (side): side is string => typeof side === 'string',
  )

  recordTelemetryAttributes({
    command: 'type-check',
    sides: JSON.stringify(selectedSides),
    verbose,
    prisma,
    generate,
  })

  /**
   * Check types for the project directory : [web, api]
   */
  const typeCheck = async () => {
    let conclusiveExitCode = 0

    const tscForAllSides = selectedSides.map((side) => {
      const projectDir = path.join(getPaths().base, side)
      return {
        cwd: projectDir,
        command: 'yarn tsc --noEmit --skipLibCheck',
      }
    })

    const { result } = concurrently(tscForAllSides, {
      group: true,
      raw: true,
    })

    try {
      await result
    } catch (error: unknown) {
      if (isConcurrentlyErrorArray(error)) {
        const exitCodes = error
          .map((entry) => entry.exitCode)
          .filter((exitCode): exitCode is number => Boolean(exitCode))

        conclusiveExitCode = Math.max(...exitCodes)
      }
    }

    return conclusiveExitCode
  }

  if (generate && prisma) {
    await generatePrismaClient({
      verbose,
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
        renderer: verbose ? 'verbose' : undefined,
      },
    ).run()
  }

  const exitCode = await typeCheck()
  if (exitCode > 0) {
    process.exitCode = exitCode
  }
}
