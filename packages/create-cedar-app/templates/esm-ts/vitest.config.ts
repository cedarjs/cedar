import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['<rootDir>/{*,!(node_modules)/**/}/vite?(st).config.{js,ts}'],
  },
})
