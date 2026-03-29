import fs from 'node:fs'
import path from 'node:path'

import boxen from 'boxen'
import execa from 'execa'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../lib/index.js'
import { isPgliteProject, startPglite, stopPglite } from '../lib/pglite.js'

type PrismaHandlerArgs = Record<string, unknown> & {
  _?: unknown[]
  $0?: string
  commands?: unknown[]
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

function getExitCode(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('exitCode' in value) ||
    typeof value.exitCode !== 'number'
  ) {
    return undefined
  }

  return value.exitCode
}

export const handler = async ({
  _: _positionals,
  $0: _binName,
  commands = [],
  ...options
}: PrismaHandlerArgs) => {
  recordTelemetryAttributes({
    command: 'prisma',
  })

  const cedarPaths = getPaths()
  const isPglite = isPgliteProject()

  if (isPglite) {
    console.log()
    console.log(c.note('Detected PGlite project, starting socket server...'))
    const started = await startPglite()
    if (!started) {
      console.error(c.error('Failed to start PGlite server'))
      process.exit(1)
    }
    console.log(c.success('PGlite socket server started on port 5433'))
    console.log()
  }

  const args = [...(Array.isArray(commands) ? commands : [])].filter(
    (value): value is string => typeof value === 'string',
  )

  // Prisma only supports '--help', but Cedar's CLI supports `prisma <command> help`
  const helpIndex = args.indexOf('help')
  if (helpIndex !== -1) {
    options.help = true
    args.splice(helpIndex, 1)
  }

  // Automatically inject options for some commands.
  const hasHelpOption = options.help || options.h
  if (!hasHelpOption) {
    if (!fs.existsSync(cedarPaths.api.prismaConfig)) {
      console.error()
      console.error(c.error('No Prisma config file found.'))
      console.error(`Cedar searched here '${cedarPaths.api.prismaConfig}'`)
      console.error()
      process.exit(1)
    }

    options.config = `${cedarPaths.api.prismaConfig}`
  }

  // Convert command and options into a string that's run via execa
  for (const [name, value] of Object.entries(options)) {
    // Allow both long and short form commands, e.g. --name and -n
    args.push(name.length > 1 ? `--${name}` : `-${name}`)
    if (typeof value === 'string') {
      // Make sure options that take multiple quoted words, like
      // `-n "create user"` are passed to prisma with quotes.
      if (value.split(' ').length > 1) {
        args.push(`"${value}"`)
      } else {
        args.push(value)
      }
    } else if (typeof value === 'number') {
      args.push(String(value))
    }
  }

  console.log()
  console.log(c.note('Running Prisma CLI...'))
  console.log(c.underline(`$ yarn prisma ${args.join(' ')}`))
  console.log()

  let exitCode = 0

  try {
    const prismaBin = path.join(cedarPaths.base, 'node_modules/.bin/prisma')
    execa.sync(prismaBin, args, {
      cwd: cedarPaths.base,
      stdio: 'inherit',
      cleanup: true,
    })

    if (hasHelpOption || args.length === 0) {
      printWrapInfo()
    }
  } catch (error: unknown) {
    errorTelemetry(
      process.argv,
      `Error generating prisma client: ${getErrorMessage(error)}`,
    )
    exitCode = getExitCode(error) ?? 1
  } finally {
    if (isPglite) {
      await stopPglite()
    }
  }

  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}

const printWrapInfo = () => {
  const message = [
    c.bold('Cedar CLI wraps Prisma CLI'),
    '',
    'Use `yarn cedar prisma` to automatically pass `--config` and `--preview-feature` options.',
    "Use `yarn prisma` to skip Cedar's automatic CLI options.",
    '',
    'Find more information in our docs:',
    c.underline('https://cedarjs.com/docs/cli-commands#prisma'),
  ]

  console.log(
    boxen(message.join('\n'), {
      padding: { top: 0, bottom: 0, right: 1, left: 1 },
      margin: 1,
      borderColor: 'gray',
    }),
  )
}
