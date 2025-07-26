import { getSchema } from '@prisma/internals'
import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getPaths } from '@cedarjs/project-config'

import { getDefaultDb, checkAndReplaceDirectUrl } from './directUrlHelpers.js'

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
    const defaultDb = getDefaultDb(cedarPaths.base)

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

    // NOTE: This is a workaround to get the directUrl from the schema
    // Instead of using the schema, we can use the config file
    // const prismaConfig = await getConfig(rwjsPaths.api.dbSchema)
    // and then check for the prismaConfig.datasources[0].directUrl
    const prismaSchema = (await getSchema(cedarPaths.api.dbSchema)).toString()

    const directUrlEnvVar = checkAndReplaceDirectUrl(prismaSchema, defaultDb)

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const directUrlDefinition = directUrlEnvVar
      ? { [directUrlEnvVar]: process.env[directUrlEnvVar] }
      : {}

    execa.sync(`yarn rw`, command, {
      cwd: cedarPaths.api.base,
      stdio: 'inherit',
      shell: true,
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
        ...directUrlDefinition,
      },
    })

    return {
      teardown() {},
    }
  },
}

export default CedarApiVitestEnvironment
