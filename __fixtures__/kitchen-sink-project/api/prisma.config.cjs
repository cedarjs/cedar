const { defineConfig, env } = require('prisma/config')

const testEnvVar = env('CEDAR_SMOKE_TEST_ENV_VAR')
if (testEnvVar !== 'test-value') {
  throw new Error('CEDAR_SMOKE_TEST_ENV_VAR has the wrong value: ' + testEnvVar)
}

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
