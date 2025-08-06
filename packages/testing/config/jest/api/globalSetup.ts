import { getSchema } from '@prisma/internals'

import { getPaths } from '@cedarjs/project-config'
import {
  getDefaultDb,
  checkAndReplaceDirectUrl,
} from '@cedarjs/testing/dist/cjs/api/directUrlHelpers'

const rwjsPaths = getPaths()

export default async function () {
  if (process.env.SKIP_DB_PUSH !== '1') {
    // Load dotenvs
    await import('dotenv-defaults/config.js')

    const defaultDb = getDefaultDb(rwjsPaths.base)

    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || defaultDb

    // NOTE: This is a workaround to get the directUrl from the schema
    // Instead of using the schema, we can use the config file
    // const prismaConfig = await getConfig(rwjsPaths.api.dbSchema)
    // and then check for the prismaConfig.datasources[0].directUrl
    const prismaSchema = (await getSchema(rwjsPaths.api.dbSchema)).toString()

    const directUrlEnvVar = checkAndReplaceDirectUrl(prismaSchema, defaultDb)

    const command =
      process.env.TEST_DATABASE_STRATEGY === 'reset'
        ? ['prisma', 'migrate', 'reset', '--force', '--skip-seed']
        : ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss']

    const { default: execa } = await import('execa')
    const env: Record<string, string | undefined> = {
      DATABASE_URL: process.env.DATABASE_URL,
    }

    if (directUrlEnvVar) {
      env[directUrlEnvVar] = process.env[directUrlEnvVar]
    }

    execa.sync('yarn rw', command, {
      cwd: rwjsPaths.api.base,
      stdio: 'inherit',
      shell: true,
      env,
    })
  }
}
