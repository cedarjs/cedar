import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'

type ServeApiArgv = {
  apiRootPath?: string
  port?: number
}

export const apiServerFileHandler = async (argv: ServeApiArgv) => {
  const args = ['node', 'server.js', '--apiRootPath', argv.apiRootPath]

  if (argv.port) {
    args.push('--apiPort', String(argv.port))
  }

  const filteredArgs = args.filter((arg): arg is string => Boolean(arg))

  await execa('yarn', filteredArgs, {
    cwd: getPaths().api.dist,
    stdio: 'inherit',
  })
}
