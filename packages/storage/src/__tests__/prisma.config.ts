import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'unit-test-schema.prisma',
  migrations: {
    path: 'migrations',
    seed: 'yarn cedar exec seed',
  },
  datasource: {
    url: 'file:for_unit_test.db',
  },
})
