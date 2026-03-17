import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/fixtures', '**/__typetests__'],
    deps: {
      interopDefault: false,
    },
    globalSetup: ['vitest.setup.mts'],
  },
})
