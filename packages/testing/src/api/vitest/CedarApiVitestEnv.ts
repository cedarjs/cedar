import type { Environment } from 'vitest/environments'

import { disposeCedarPgTest } from '../cedarPgLifecycle.js'
import { prepareApiTestDatabase } from '../prepareApiTestDatabase.js'

const CedarApiVitestEnvironment: Environment = {
  name: 'cedar-api',
  viteEnvironment: 'ssr',

  async setup() {
    if (process.env.SKIP_DB_PUSH === '1') {
      return {
        teardown() {},
      }
    }

    await prepareApiTestDatabase()

    return {
      async teardown() {
        await disposeCedarPgTest()
      },
    }
  },
}

export default CedarApiVitestEnvironment
