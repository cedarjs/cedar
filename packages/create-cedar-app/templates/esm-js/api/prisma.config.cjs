const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: '{{CEDAR_CLI}} exec seed',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
