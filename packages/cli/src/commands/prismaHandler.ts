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

interface PrismaOptions {
  _?: string[]
  $0?: string
  commands?: string[]
  [key: string]: unknown
}

export const handler = async ({
  _ = [],
  $0: _0 = '',
  commands = [],
  ...options
}: PrismaOptions) => {
  recordTelemetryAttributes({
    command: 'prisma',
  })

  const rwjsPaths = getPaths()

  // Prisma only supports '--help', but Cedar's CLI supports `prisma <command> help`
  const helpIndex = commands.indexOf('help')
  if (helpIndex !== -1) {
    options.help = true
    commands.splice(helpIndex, 1)
  }

  // Automatically inject options for some commands.
  const hasHelpOption = options.help || options.h
  if (!hasHelpOption) {
    if (!fs.existsSync(rwjsPaths.api.prismaConfig)) {
      console.error()
      console.error(c.error('No Prisma config file found.'))
      console.error(`Cedar searched here '${rwjsPaths.api.prismaConfig}'`)
      console.error()
      process.exit(1)
    }

    options.config = `${rwjsPaths.api.prismaConfig}`
  }

  // Convert command and options into a string that's run via execa
  const args: (string | number)[] = [...commands]
  for (const [name, value] of Object.entries(options)) {
    // Allow both long and short form commands, e.g. --name and -n
    args.push(name.length > 1 ? `--${name}` : `-${name}`)
    if (typeof value === 'string') {
      if (value.split(' ').length > 1) {
        args.push(`"${value}"`)
      } else {
        args.push(value)
      }
    } else if (typeof value === 'number') {
      args.push(value)
    }
  }

  console.log()
  console.log(c.note('Running Prisma CLI...'))
  console.log(c.underline('$ yarn prisma ' + args.join(' ')))
  console.log()

  try {
    const prismaBin = path.join(rwjsPaths.base, 'node_modules/.bin/prisma')
    execa.sync(prismaBin, args as string[], {
      cwd: rwjsPaths.base,
      stdio: 'inherit',
      cleanup: true,
    })

    if (hasHelpOption || commands.length === 0) {
      printWrapInfo()
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    errorTelemetry(process.argv, `Error generating prisma client: ${message}`)

    if (
      e instanceof Object &&
      'exitCode' in e &&
      typeof e.exitCode === 'number'
    ) {
      process.exit(e.exitCode)
    } else {
      process.exit(1)
    }
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
