import fs from 'node:fs'

import boxen from 'boxen'

import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'
import {
  formatCedarCommand,
  formatRunBinCommand,
} from '@cedarjs/cli-helpers/packageManager/display'
import { runTransitiveBinSync } from '@cedarjs/cli-helpers/packageManager/exec'
import { errorTelemetry } from '@cedarjs/telemetry'

import { getPaths } from '../lib/index.js'

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

  // Convert command and options into the args array that's run via execa
  for (const [name, value] of Object.entries(options)) {
    // Allow both long and short form commands, e.g. --name and -n
    args.push(name.length > 1 ? `--${name}` : `-${name}`)
    if (typeof value === 'string') {
      // The args are passed to execa as an array without a shell, so each
      // value is already a single argv entry. Wrapping values in quotes here
      // would make the quotes part of the value itself, breaking e.g.
      // `--config` paths that contain spaces.
      args.push(value)
    } else if (typeof value === 'number') {
      args.push(String(value))
    }
  }

  // The real invocation passes `args` as an array without a shell, but this
  // informational line may get copy-pasted into a shell — so args containing
  // spaces need quotes here (and only here) to represent the same command.
  const displayCommand = args
    .map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
    .join(' ')

  console.log()
  console.log(c.note('Running Prisma CLI...'))
  console.log(c.underline(`$ <pm exec> prisma ${displayCommand}`))
  console.log()

  try {
    runTransitiveBinSync('prisma', args, {
      cwd: cedarPaths.base,
      stdio: 'inherit',
    })

    if (hasHelpOption || args.length === 0) {
      printWrapInfo()
    }
  } catch (error: unknown) {
    errorTelemetry(
      process.argv,
      `Error generating prisma client: ${getErrorMessage(error)}`,
    )
    process.exit(getExitCode(error) ?? 1)
  }
}

const printWrapInfo = () => {
  const message = [
    c.bold('Cedar CLI wraps Prisma CLI'),
    '',
    `Use \`${formatCedarCommand(['prisma'])}\` to automatically pass \`--config\` and \`--preview-feature\` options.`,
    `Use \`${formatRunBinCommand('prisma')}\` to skip Cedar's automatic CLI options.`,
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
