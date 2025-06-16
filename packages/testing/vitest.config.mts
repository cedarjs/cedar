import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/__fixtures__'],
    environment: 'jsdom',
    // We enable globals here for use by babel-plugin-tester
    globals: true,
    setupFiles: ['vitest.setup.mts'],
  },
})
