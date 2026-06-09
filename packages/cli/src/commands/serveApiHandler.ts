import { runBin } from '@cedarjs/cli-helpers/packageManager/exec'
import { getPaths } from '@cedarjs/project-config'

interface ServeApiArgv {
  apiRootPath?: string
  port?: number
}

export async function apiServerFileHandler(argv: ServeApiArgv) {
  const args = ['server.js', '--apiRootPath', argv.apiRootPath ?? '/']

  if (argv.port) {
    args.push('--apiPort', String(argv.port))
  }

  const filteredArgs = args.filter((arg): arg is string => Boolean(arg))

  await runBin('node', filteredArgs, {
    cwd: getPaths().api.dist,
    stdio: 'inherit',
  })
}
