import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: [...configDefaults.exclude, '**/fixtures', '**/dist'],
    logHeapUsage: true,
    // Pushes the unit test schema to a SQLite database and generates its
    // Prisma client, for the tests that run the PrismaAdapter against a real
    // database
    globalSetup: ['vitest.setup.mts'],
    typecheck: {
      enabled: true,
    },
  },
})
