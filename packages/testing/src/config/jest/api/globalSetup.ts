import path from 'node:path'

import 'dotenv-defaults/config'
import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'

export default async function () {
  if (process.env.SKIP_DB_PUSH === '1') {
    return
  }

  const cedarPaths = getPaths()

  const defaultDb = `file:${path.join(cedarPaths.generated.base, 'test.db')}`

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

  const command =
    process.env.TEST_DATABASE_STRATEGY === 'reset'
      ? ['prisma', 'migrate', 'reset', '--force']
      : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

  execa.sync('yarn', ['cedar', ...command], {
    cwd: cedarPaths.api.base,
    stdio: 'inherit',
    env: process.env,
  })
}
