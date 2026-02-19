import fs from 'node:fs'
import path from 'node:path'

import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import { Listr } from 'listr2'
import type { ListrTask } from 'listr2'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { findScripts } from '@cedarjs/internal/dist/files'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { runScriptFunction } from '../lib/exec.js'
// @ts-expect-error - Types not available for JS files
import { generatePrismaClient } from '../lib/generatePrismaClient.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../lib/index.js'

type ExecArgs = Record<string, unknown> & {
  name?: string
  prisma?: boolean
  list?: boolean
  silent?: boolean
  _?: unknown[]
  $0?: string
  l?: boolean
  s?: boolean
}
type ExecTask = ListrTask

const printAvailableScriptsToConsole = () => {
  const scripts = findScripts(getPaths().scripts).reduce(
    (acc: Record<string, string[]>, scriptPath: string) => {
      const relativePath = path.relative(getPaths().scripts, scriptPath)
      const ext = path.parse(relativePath).ext
      const pathNoExt = relativePath.slice(0, -ext.length)

      acc[pathNoExt] ||= []
      acc[pathNoExt].push(relativePath)

      return acc
    },
    {},
  )

  console.log('Available scripts:')
  Object.entries(scripts).forEach(([name, scriptPaths]) => {
    if (scriptPaths.length > 1) {
      scriptPaths.forEach((scriptPath) => {
        console.log(c.info(`- ${scriptPath}`))
      })
    } else {
      console.log(c.info(`- ${name}`))
    }
  })
  console.log()
}

export const handler = async (args: ExecArgs) => {
  recordTelemetryAttributes({
    command: 'exec',
    prisma: args.prisma,
    list: args.list,
  })

  const { name, prisma, list, ...scriptArgs } = args
  if (list || !name) {
    printAvailableScriptsToConsole()
    return
  }

  scriptArgs._ = (Array.isArray(scriptArgs._) ? scriptArgs._ : []).slice(1)

  delete scriptArgs.$0
  delete scriptArgs.l
  delete scriptArgs.s
  delete scriptArgs.silent

  const scriptPath = resolveScriptPath(name)

  if (!scriptPath) {
    console.error(
      c.error(`\nNo script called \`${name}\` in the ./scripts folder.\n`),
    )

    printAvailableScriptsToConsole()
    process.exit(1)
  }

  const scriptTasks: ExecTask[] = [
    {
      title: 'Generating Prisma client',
      enabled: () => Boolean(prisma),
      task: () =>
        generatePrismaClient({
          force: false,
          verbose: !args.silent,
          silent: args.silent,
        }),
    },
    {
      title: 'Running script',
      task: async () => {
        try {
          await runScriptFunction({
            path: scriptPath,
            functionName: 'default',
            args: { args: scriptArgs },
          })
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          console.error(c.error(`Error in script: ${message}`))
          throw error
        }
      },
    },
  ]

  const tasks = new Listr(scriptTasks, {
    renderer: args.silent ? 'silent' : 'verbose',
  })

  // Prevent user project telemetry from within the script from being recorded
  await context.with(suppressTracing(context.active()), async () => {
    await tasks.run()
  })
}

function resolveScriptPath(name: string): string | null {
  const scriptPath = path.join(getPaths().scripts, name)

  if (fs.existsSync(scriptPath)) {
    return scriptPath
  }

  const extensions = ['.js', '.jsx', '.ts', '.tsx']
  const matches: string[] = []

  for (const extension of extensions) {
    const candidate = scriptPath + extension

    if (fs.existsSync(candidate)) {
      matches.push(candidate)
    }
  }

  if (matches.length === 1) {
    return matches[0]
  } else if (matches.length > 1) {
    console.error(
      c.error(
        `\nMultiple scripts found for \`${name}\`. Please specify the ` +
          'extension.',
      ),
    )

    matches.forEach((match) => {
      console.log(c.info(`- ${path.relative(getPaths().scripts, match)}`))
    })

    process.exit(1)
  }

  return null
}
