import babelParser from '@babel/eslint-parser'
import babelPlugin from '@babel/eslint-plugin'
import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import jestDomPlugin from 'eslint-plugin-jest-dom'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import unusedImportsPlugin from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import cedarjsPlugin from '@cedarjs/eslint-plugin'
import { findUp } from '@cedarjs/project-config'

// Framework Babel config is monorepo root ./babel.config.js
// `yarn lint` runs for each workspace, which needs findUp for path to root
const findBabelConfig = (cwd = process.cwd()) => {
  const configPath = findUp('babel.config.js', cwd)
  if (!configPath) {
    throw new Error(`Eslint-parser could not find a "babel.config.js" file`)
  }
  return configPath
}

export default [
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/fixtures/**',
      '**/__fixtures__/**',
      '**/__testfixtures__/**',
      '**/*.template',
      'packages/babel-config/src/plugins/__tests__/__fixtures__/**/*',
      'packages/babel-config/src/__tests__/__fixtures__/**/*',
      'packages/codemods/**/__testfixtures__/**/*',
      'packages/cli/**/__testfixtures__/**/*',
      'packages/internal/src/__tests__/__fixtures__/**/*',
      'packages/prerender/**/__tests__/__fixtures__/**/*',
      'packages/storage/src/__tests__/prisma-client/*',
      'packages/testing/config',
      'packages/testing/**/__fixtures__/**/*',
      'packages/vite/src/plugins/__tests__/__fixtures__/**/*',
      'packages/create-cedar-rsc-app/**',
      'packages/create-cedar-app/templates/**',
    ],
  },

  // Configuration for this eslint config file itself
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Base configuration for all files
  js.configs.recommended,
  {
    plugins: {
      '@babel': babelPlugin,
      import: importPlugin,
      'jsx-a11y': jsxA11yPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jest-dom': jestDomPlugin,
      'unused-imports': unusedImportsPlugin,
      '@cedarjs': cedarjsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
      // For the import/order rule. Configures how it tells if an import is "internal" or not.
      // An "internal" import is basically just one that's aliased.
      //
      // See...
      // - https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md#groups-array
      // - https://github.com/import-js/eslint-plugin-import/blob/main/README.md#importinternal-regex
      'import/internal-regex': '^src/',
    },
    rules: {
      // React recommended rules
      ...reactPlugin.configs.recommended.rules,
      // React hooks recommended rules
      ...reactHooksPlugin.configs.recommended.rules,
      // Jest DOM recommended rules
      ...jestDomPlugin.configs.recommended.rules,

      curly: 'error',
      'unused-imports/no-unused-imports': 'error',
      'no-console': 'off',
      'no-extra-semi': 'off',
      'prefer-object-spread': 'warn',
      'prefer-spread': 'warn',
      'no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'no-useless-escape': 'off',
      camelcase: ['warn', { properties: 'never' }],
      'no-new': 'warn',
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      // React rules
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          // We set this to an empty array to override the default value, which is `['builtin', 'external', 'object']`.
          // Judging by the number of issues on the repo, this option seems to be notoriously tricky to understand.
          // From what I can tell, if the value of this is `['builtin']` that means it won't sort builtins.
          // But we have a rule for builtins below (react), so that's not what we want.
          //
          // See...
          // - https://github.com/import-js/eslint-plugin-import/pull/1570
          // - https://github.com/import-js/eslint-plugin-import/issues/1565
          pathGroupsExcludedImportTypes: [],
          // Only doing this to add internal. The order here maters.
          // See https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md#groups-array
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          pathGroups: [
            {
              pattern: 'react',
              group: 'builtin',
              position: 'after',
            },
            {
              pattern: '@cedarjs/**',
              group: 'external',
              position: 'after',
            },
            {
              // Matches...
              // - src/directives/**/*.{js,ts}
              // - src/services/**/*.{js,ts}
              // - src/graphql/**/*.sdl.{js,ts}
              //
              // Uses https://github.com/isaacs/minimatch under the hood
              // See https://github.com/isaacs/node-glob#glob-primer for syntax
              pattern: 'src/*/**/*.?(sdl.){js,ts}',
              patternOptions: {
                nobrace: true,
                noglobstar: true,
              },
              group: 'internal',
              position: 'before',
            },
          ],
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },

  // JavaScript files specific configuration
  {
    files: ['**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        babelOptions: {
          configFile: findBabelConfig(),
        },
      },
      globals: {
        ...globals.es2022,
      },
    },
  },

  // We disable react-hooks/rules-of-hooks for packages which do not deal with React code
  {
    files: [
      'packages/api-server/**/*.ts',
      'packages/graphql-server/**/*.ts',
      'packages/realtime/**/*.ts',
    ],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },

  // TypeScript specific linting
  ...tseslint.config({
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Disable unused-imports for TypeScript files, use TypeScript's own rule instead
      'unused-imports/no-unused-imports': 'off',

      // This is disabled for now because of our legacy usage of `require`. It should be enabled in the future.
      '@typescript-eslint/no-require-imports': 'off',
      // This is disabled for now because of our vast usage of `any`. It should be enabled in the future.
      '@typescript-eslint/no-explicit-any': 'off',

      // We allow exceptions to the no-unused-vars rule for variables that start with an underscore
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],

      // We want consistent `import type {} from '...'`
      '@typescript-eslint/consistent-type-imports': 'error',

      // We want consistent curly brackets
      curly: 'error',

      // Stylistic rules we have disabled
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/prefer-function-type': 'off',
      camelcase: 'off',

      // TODO(jgmw): Work through these and either keep disabled or fix and re-enable
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  }),

  // Test files
  {
    files: ['*.test.*', '**/__mocks__/**', '**/*.test.*'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
        ...globals.jest,
      },
    },
  },

  // Config files (.babelrc.js, jest.config.js, etc.) and CJS wrapper files
  {
    files: [
      '**/.babelrc.js',
      '**/babel.config.js',
      '**/jest.config.js',
      '**/jest.setup.js',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      'packages/web/apollo/index.js',
      'packages/web/toast/index.js',
      'packages/auth-providers/dbAuth/web/webAuthn/index.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
      sourceType: 'commonjs',
    },
  },

  // Browser Context
  //
  // We prevent "window" from being used, and instead require "global".
  // This is because prerender runs in the NodeJS context it's undefined.
  {
    files: [
      'packages/auth/src/**',
      'packages/forms/src/**',
      'packages/prerender/src/browserUtils/**',
      'packages/router/src/**',
      'packages/web/src/**',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        window: 'off', // Developers should use `global` instead of window. Since window is undefined in NodeJS.
      },
    },
  },

  // Prevent @cedarjs/internal imports in runtime (web+api) packages
  {
    files: [
      'packages/auth/src/**',
      'packages/forms/src/**',
      'packages/prerender/src/browserUtils/**',
      'packages/router/src/**',
      'packages/web/src/**',
      'packages/api/src/**',
      'packages/graphql-server/src/**',
      'packages/record/src/**',
      'packages/project-config/src/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@cedarjs/internal', '@cedarjs/internal/*'],
              message:
                'Do not import "@cedarjs/internal" or subpackages in runtime modules, because it leads to MASSIVE bundle sizes',
            },
            {
              group: ['@cedarjs/structure', '@cedarjs/structure/*'],
              message:
                'Do not import "@cedarjs/structure" or subpackages in runtime modules, because it leads to MASSIVE bundle sizes',
            },
          ],
        },
      ],
    },
  },

  // Entry.js rules
  {
    files: ['packages/web/src/entry/index.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        React: 'readonly',
      },
    },
  },

  // NodeJS Context
  {
    files: [
      '.github/**',
      'packages/api/src/**',
      'packages/api-server/src/**',
      'packages/cli/src/**',
      'packages/create-cedar-app/src/*.js',
      'packages/create-cedar-app/scripts/**',
      'packages/internal/src/**',
      'packages/prerender/src/**',
      'packages/structure/src/**',
      'packages/testing/src/**',
      'packages/testing/config/**',
      'packages/eslint-config/*.js',
      'packages/record/src/**',
      'packages/telemetry/src/**',
      'packages/vite/bins/**',
      'packages/cli-packages/**/*.mjs',
      'packages/codemods/tasks/**',
      'packages/ogimage-gen/cjsWrappers/**',
      'tasks/**',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Prevent bad imports in Node packages - cli and api packages
  {
    files: [
      'packages/api/src/**',
      'packages/api-server/src/**',
      'packages/cli/src/**',
      'packages/internal/src/**',
      'packages/prerender/src/**',
      'packages/structure/src/**',
      'packages/testing/src/**',
      'packages/testing/config/**',
      'packages/eslint-config/*.js',
      'packages/record/src/**',
      'packages/telemetry/src/**',
    ],
    rules: {
      'no-restricted-imports': [
        // for import x from ('@cedarjs/internal')
        'error',
        {
          name: '@cedarjs/internal',
          message:
            'To prevent bloat in CLI, do not import "@cedarjs/internal" directly. Instead import like @cedarjs/internal/dist/<file>, or await import',
        },
      ],
      'no-restricted-modules': [
        // for require('@cedarjs/internal')
        'error',
        {
          name: '@cedarjs/internal',
          message:
            'To prevent bloat in CLI, do not require "@cedarjs/internal" directly. Instead require like @cedarjs/internal/dist/<file>',
        },
      ],
    },
  },

  // Allow computed member access on process.env in NodeJS contexts and tests
  {
    files: [
      'packages/project-config/src/envVarDefinitions.ts',
      'packages/testing/**',
      'packages/vite/src/plugins/vite-plugin-cedar-html-env.ts',
      '.github/**',
    ],
    rules: {
      '@cedarjs/process-env-computed': 'off',
    },
  },

  // project-config package specific rules
  {
    files: ['packages/project-config/**'],
    ignores: ['**/__tests__/**', '**/*.test.ts?(x)', '**/*.spec.ts?(x)'],
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: false,
          optionalDependencies: false,
          peerDependencies: true,
        },
      ],
    },
  },
]
