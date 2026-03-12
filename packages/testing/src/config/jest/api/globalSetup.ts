import 'dotenv-defaults/config'
import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'

import {
  getDefaultDb,
  checkAndReplaceDirectUrl,
} from '../../../api/directUrlHelpers.js'

const rwjsPaths = getPaths()

export default async function () {
  if (process.env.SKIP_DB_PUSH === '1') {
    return
  }

  const defaultDb = getDefaultDb(rwjsPaths.base)

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

  const directUrlEnvVar = await checkAndReplaceDirectUrl()

  const command =
    process.env.TEST_DATABASE_STRATEGY === 'reset'
      ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
      : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

  const env: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
  }

  if (directUrlEnvVar) {
    env[directUrlEnvVar] = process.env[directUrlEnvVar]
  }

  execa.sync('yarn', ['cedar', ...command], {
    cwd: rwjsPaths.api.base,
    stdio: 'inherit',
    env,
  })
}
