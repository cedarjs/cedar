import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    logHeapUsage: true,
    include: ['*.test.mts'],
  },
})
