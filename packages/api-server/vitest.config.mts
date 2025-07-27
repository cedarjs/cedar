import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/fixtures'],
    pool: 'threads',
    hookTimeout: process.platform === 'win32' ? 30_000 : 10_000,
  },
})
