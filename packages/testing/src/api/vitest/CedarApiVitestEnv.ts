import prismaInternals from '@prisma/internals'
import 'dotenv-defaults/config.js'
import execa from 'execa'
import type { Environment } from 'vitest/environments'

import { getPaths, getSchemaPath } from '@cedarjs/project-config'

import { getDefaultDb, checkAndReplaceDirectUrl } from '../directUrlHelpers.js'

const { getSchemaWithPath } = prismaInternals

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
    // TODO: Fix comment above now that we've changed to `getSchemaPath()`
    const schemaPath = await getSchemaPath(cedarPaths.api.prismaConfig)
    const result = await getSchemaWithPath(schemaPath)
    // For regex matching, we need to concatenate the schemas into a single string
    const prismaSchema = result.schemas.map(([, content]) => content).join('\n')

    const directUrlEnvVar = checkAndReplaceDirectUrl(prismaSchema, defaultDb)

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const directUrlDefinition = directUrlEnvVar
      ? { [directUrlEnvVar]: process.env[directUrlEnvVar] }
      : {}

    execa.sync('yarn', ['rw', ...command], {
      cwd: cedarPaths.api.base,
      stdio: 'inherit',
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
