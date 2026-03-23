import execa from 'execa'

import {
  formatRunBinCommand,
  getPackageManager,
} from '@cedarjs/cli-helpers/packageManager'

// @ts-expect-error - Types not available for JS files
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
  const positionalArgs = Array.isArray(_) ? [..._] : []
  const commandArg = positionalArgs.pop()
  const args = [commandArg == null ? '' : String(commandArg)]

  for (const [name, value] of Object.entries(options)) {
    // Allow both long and short form commands, e.g. --name and -n
    args.push(name.length > 1 ? `--${name}` : `-${name}`)
    args.push(String(value))
  }

  const pm = getPackageManager()
  let command = formatRunBinCommand('rw-jobs', args, pm)
  const originalLogLevel = process.env.LOG_LEVEL
  process.env.LOG_LEVEL = originalLogLevel || 'warn'

  // make logs look nice in development (assume any env that's not prod is dev)
  // that includes showing more verbose logs unless the user set otherwise
  if (process.env.NODE_ENV !== 'production') {
    command += ` | ${formatRunBinCommand('rw-log-formatter', [], pm)}`
    process.env.LOG_LEVEL = originalLogLevel || 'debug'
  }

  execa.commandSync(command, {
    shell: true,
    cwd: getPaths().base,
    stdio: 'inherit',
    cleanup: true,
  })
}
