import {
  getPackageManager,
  runBin,
  runPackageManagerCommand,
} from '@cedarjs/cli-helpers/packageManager'
import { getPaths } from '@cedarjs/project-config'

type ServeApiArgv = {
  apiRootPath?: string
  port?: number
}

export const apiServerFileHandler = async (argv: ServeApiArgv) => {
  const args = ['server.js', '--apiRootPath', argv.apiRootPath]

  if (argv.port) {
    args.push('--apiPort', String(argv.port))
  }

  const filteredArgs = args.filter((arg): arg is string => Boolean(arg))

  await runPackageManagerCommand(
    runBin('node', filteredArgs, getPackageManager()),
    {
      cwd: getPaths().api.dist,
      stdio: 'inherit',
    },
  )
}
