import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 15_000,
    include: ['__tests__/**/*.test.{mts,ts}'],
  },
})
