import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    logHeapUsage: true,
    setupFiles: ['./vitest.setup.mts'],
    include: ['*.test.mts'],
    // These are live network calls against real provider infrastructure;
    // the default 5s timeout is too tight for that plus CI network jitter.
    testTimeout: 20_000,
  },
})
