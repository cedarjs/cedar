import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    logHeapUsage: true,
    setupFiles: ['./vitest.setup.mts'],
    include: ['*.test.mts'],
  },
})
