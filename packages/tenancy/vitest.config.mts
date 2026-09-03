import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      '**/fixtures',
      '**/__typetests__',
    ],
    deps: {
      interopDefault: false,
    },
    globalSetup: ['vitest.setup.mts'],
    setupFiles: ['vitest.setupFiles.mts'],
    // Several test files share one real SQLite database file
    // (`src/__tests__/for_unit_test.db`) and reset it between tests; running
    // test files in parallel would race on that shared file.
    fileParallelism: false,
  },
  define: {
    RWJS_ENV: {},
  },
})
