import path from 'node:path'

import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

const CedarApiVitestEnvironment: Environment = {
  name: 'cedar-api',
  viteEnvironment: 'ssr',

  async setup() {
    if (process.env.SKIP_DB_PUSH === '1') {
      return {
        teardown() {},
      }
    }

    const cedarPaths = getPaths()

    let disposeCedarPg: (() => Promise<void>) | undefined
    const cedarPgOn =
      process.env.CEDAR_PG === '1' || process.env.CEDAR_PG === 'true'

    if (cedarPgOn) {
      // Resolve from the app (same pattern as @cedarjs/cli/lib/cedarPg)
      const { createRequire } = await import('node:module')
      const { pathToFileURL } = await import('node:url')
      const require = createRequire(
        path.join(cedarPaths.api.base, 'package.json'),
      )
      const resolved = require.resolve('@cedarjs/pg')
      const cedarPg = await import(pathToFileURL(resolved).href)
      const result = await cedarPg.ensureIfNeeded({
        root: cedarPaths.base,
        mode: 'test',
        setEnv: true,
        url: process.env.TEST_DATABASE_URL,
        force: process.env.CEDAR_PG_FORCE === '1',
        disabled: false,
      })
      if (result.status === 'ensured') {
        disposeCedarPg = () => result.dispose()
      }
    } else {
      const defaultDb = `file:${path.join(cedarPaths.generated.base, 'test.db')}`
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb
    }

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const pm = getPackageManager()
    // This kind of logic should not live here. We have it in cli-helpers, but
    // it also doesn't make sense to have the testing package depend on
    // cli-helpers I don't think. So I duplicate the logic here.
    // see `runTransitiveBinSync` in packages/cli-helpers/src/packageManager/exec.ts
    const pmExec = pm === 'pnpm' ? pm : 'npx'
    execa.sync(pmExec, ['cedar', ...command], {
      cwd: cedarPaths.api.base,
      stdio: 'inherit',
      env: process.env,
    })

    return {
      async teardown() {
        if (disposeCedarPg) {
          await disposeCedarPg()
        }
      },
    }
  },
}

export default CedarApiVitestEnvironment
