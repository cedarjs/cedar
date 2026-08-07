import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      // Vitest 4 removed `**/dist/**` from its default excludes. Compiled
      // copies of the .tsx test files end up in dist (and dist/cjs, where
      // they'd crash since Vitest can't be require()d from CJS), so keep
      // excluding them like Vitest 3 did
      '**/dist/**',
      '**/fixtures',
      '**/__typetests__',
    ],
    environment: 'jsdom',
    setupFiles: ['vitest.setup.mts'],
  },
  define: {
    RWJS_ENV: {},
  },
})
