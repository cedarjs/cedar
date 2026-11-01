import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'validators',
    // Enables global test APIs like describe, it, expect
    globals: true,
  },
})
