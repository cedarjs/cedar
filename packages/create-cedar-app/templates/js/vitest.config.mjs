import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['<rootDir>/{*,packages/*}/vite?(st).config.{js,ts}'],
  },
})
