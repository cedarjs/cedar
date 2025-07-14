import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 20_000,
    sequence: {
      hooks: 'list',
    },
    logHeapUsage: true,
    exclude: [
      ...configDefaults.exclude,
      '**/__tests__/fixtures/**/*',
      '__fixtures__',
      '__testfixtures__',
      '__tests__/utils/*',
      '.d.ts',
      'dist',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'root',
          include: ['**/*.test.[jt]s?(x)'],
          exclude: ['**/__codemod_tests__'],
          alias: {
            '^src/(.*)': '<rootDir>/src/$1',
          },
          setupFiles: ['./vitest.setup.mts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'setup codemods',
          include: ['**/commands/setup/**/__codemod_tests__/*.ts'],
          setupFiles: ['./vitest.codemods.setup.ts'],
          pool: 'forks',
        },
      },
    ],
    env: {
      FORCE_COLOR: 'true',
    },
  },
})
