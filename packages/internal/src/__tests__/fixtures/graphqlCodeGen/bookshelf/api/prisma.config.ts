import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'db/schema.prisma',
  migrations: {
    path: 'db/migrations',
  },
  datasource: {
    url: 'file:./dev.db',
  },
})
