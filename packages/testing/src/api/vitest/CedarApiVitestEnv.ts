import path from 'node:path'

import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

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

    const defaultDb = `file:${path.join(cedarPaths.generated.base, 'test.db')}`

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const pm = getPackageManager()
    const pmExec = pm === 'npm' ? 'npx' : pm
    const pmArgs =
      pm === 'pnpm' ? ['exec', 'cedar', ...command] : ['cedar', ...command]
    execa.sync(pmExec, pmArgs, {
      cwd: cedarPaths.api.base,
      stdio: 'inherit',
      env: process.env,
    })

    return {
      teardown() {},
    }
  },
}

export default CedarApiVitestEnvironment
