import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/__typetests__'],
    sequence: {
      hooks: 'list',
    },
    setupFiles: ['./vitest.setup.mts'],
    logHeapUsage: true,
  },
})
