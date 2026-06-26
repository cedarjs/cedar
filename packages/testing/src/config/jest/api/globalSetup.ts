import path from 'node:path'

import 'dotenv-defaults/config'
import execa from 'execa'

import { getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

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

  const pm = getPackageManager()
  // This kind of logic should not live here. We have it in cli-helpers, but it
  // also doesn't make sense to have the testing package depend on cli-helpers
  // I don't think. So I duplicate the logic here.
  // see `runTransitiveBinSync` in packages/cli-helpers/src/packageManager/exec.ts
  const pmExec = pm === 'pnpm' ? pm : 'npx'
  execa.sync(pmExec, ['cedar', ...command], {
    cwd: cedarPaths.api.base,
    stdio: 'inherit',
    env: process.env,
  })
}
