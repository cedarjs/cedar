import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'unit-test-schema.prisma',
  migrations: {
    path: 'migrations',
    seed: 'yarn cedar exec seed',
  },
})
