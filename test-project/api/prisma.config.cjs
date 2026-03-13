const { defineConfig, env } = require('prisma/config')

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: 'process.env.DATABASE_URL',
    _url: env('DATABASE_URL'),
  },
})
