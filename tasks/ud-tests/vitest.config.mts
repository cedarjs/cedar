import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    logHeapUsage: true,
    setupFiles: ['./vitest.setup.mts'],
    // Run test suites in series because we start and stop servers
    // on the same host and port between test cases.
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
