import path from 'node:path'

import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getPaths } from '@cedarjs/project-config'

const CedarApiVitestEnvironment: Environment = {
  name: 'cedar-api',
  transformMode: 'ssr',

  async setup() {
    if (process.env.SKIP_DB_PUSH === '1') {
      return {
        teardown() {},
      }
    }

    const cedarPaths = getPaths()

    const defaultDb = `file:${path.join(cedarPaths.base, '.redwood', 'test.db')}`

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    execa.sync('yarn', ['cedar', ...command], {
      cwd: cedarPaths.api.base,
      stdio: 'inherit',
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
    })

    return {
      teardown() {},
    }
  },
}

export default CedarApiVitestEnvironment
