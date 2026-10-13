import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: [...configDefaults.exclude, '**/fixtures', '**/dist'],
    logHeapUsage: true,
    // Generates the unit test schema's Prisma client and SQL, for the tests
    // that run the PrismaAdapter against a real database
    globalSetup: ['vitest.setup.mts'],
    typecheck: {
      enabled: true,
    },
  },
})
