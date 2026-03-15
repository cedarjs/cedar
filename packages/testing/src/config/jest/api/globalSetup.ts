import path from 'node:path'

import 'dotenv-defaults/config'
import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'

export default async function () {
  if (process.env.SKIP_DB_PUSH === '1') {
    return
  }

  const cedarPaths = getPaths()

  const defaultDb = `file:${path.join(cedarPaths.base, '.redwood', 'test.db')}`

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

  const command =
    process.env.TEST_DATABASE_STRATEGY === 'reset'
      ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
      : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

  const env: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
  }

  execa.sync('yarn', ['cedar', ...command], {
    cwd: cedarPaths.api.base,
    stdio: 'inherit',
    env,
  })
}
