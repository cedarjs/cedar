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

  await execa('yarn', args.filter(Boolean) as string[], {
    cwd: getPaths().api.dist,
    stdio: 'inherit',
  })
}
