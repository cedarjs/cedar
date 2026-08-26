const { defineConfig, env } = require('prisma/config')

// ENV_DEFAULTS_VAR is loaded from .env.defaults
const testEnvVar = env('ENV_DEFAULTS_VAR')
if (testEnvVar !== 'default-value') {
  throw new Error('ENV_DEFAULTS_VAR has the wrong value: ' + testEnvVar)
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
