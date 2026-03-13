const { defineConfig, env } = require('prisma/config')

console.log('process.env.NODE_ENV', process.env.NODE_ENV)

module.exports = defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: env('MY_DATABASE_URL'),
  },
})
