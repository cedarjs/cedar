import execa from 'execa'

import { formatRunBinCommand } from '@cedarjs/cli-helpers/packageManager/display'

import { getPaths } from '../lib/index.js'

type JobsHandlerArgs = Record<string, unknown> & {
  _?: unknown[]
  $0?: string
  commands?: unknown
}

export const handler = async ({
  _,
  $0: _rw,
  commands: _commands,
  ...options
}: JobsHandlerArgs) => {
  // Everything after `jobs` is forwarded: the command and its own
  // positionals, like `pause ReportJob:nightly`
  const positionalArgs = (Array.isArray(_) ? _ : []).map(String)

  if (positionalArgs[0] === 'jobs') {
    positionalArgs.shift()
  }

  const args = positionalArgs.length > 0 ? positionalArgs : ['']

  for (const [name, value] of Object.entries(options)) {
    // Allow both long and short form commands, e.g. --name and -n
    args.push(name.length > 1 ? `--${name}` : `-${name}`)
    args.push(String(value))
  }

  let command = formatRunBinCommand('cedar-jobs', args)
  const originalLogLevel = process.env.LOG_LEVEL
  process.env.LOG_LEVEL = originalLogLevel || 'warn'

  // make logs look nice in development (assume any env that's not prod is dev)
  // that includes showing more verbose logs unless the user set otherwise
  if (process.env.NODE_ENV !== 'production') {
    command += ` | ${formatRunBinCommand('cedar-log-formatter')}`
    process.env.LOG_LEVEL = originalLogLevel || 'debug'
  }

  execa.commandSync(command, {
    shell: true,
    cwd: getPaths().base,
    stdio: 'inherit',
    cleanup: true,
  })
}
