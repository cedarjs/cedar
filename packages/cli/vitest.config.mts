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
      // NO_COLOR is cleared in vitest.setup.mts. (In Vitest 4 setting
      // `NO_COLOR: undefined` here would set it to the string "undefined"
      // instead of removing it, which makes Node print a warning that breaks
      // assertions in a few tests (i.e. cwd.test.ts))
      FORCE_COLOR: 'true',
    },
  },
})
