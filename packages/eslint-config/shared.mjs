// This ESLint configuration is shared between the Redwood framework,
// and Redwood projects.
//
// Our ESLint configuration is a mixture between ESLint's recommended
// rules [^1], React's recommended rules [^2], and a bit of our own stylistic
// flair:
// - no semicolons
// - comma dangle when multiline
// - single quotes
// - always use parenthesis around arrow functions
// - enforced import sorting
//
// [^1] https://eslint.org/docs/rules/
// [^2] https://www.npmjs.com/package/eslint-plugin-react#list-of-supported-rules

import babelParser from '@babel/eslint-parser'
import babelPlugin from '@babel/eslint-plugin'
import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import jestDomPlugin from 'eslint-plugin-jest-dom'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import prettierPlugin from 'eslint-plugin-prettier'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import cedarjsPlugin from '@cedarjs/eslint-plugin'

export default [
  // Base recommended config
  js.configs.recommended,

  // Base configuration
  {
    plugins: {
      '@babel': babelPlugin,
      prettier: prettierPlugin,
      import: importPlugin,
      'jsx-a11y': jsxA11yPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jest-dom': jestDomPlugin,
      '@cedarjs': cedarjsPlugin,
    },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
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
      // Jest DOM recommended rules
      ...jestDomPlugin.configs.recommended.rules,

      '@cedarjs/process-env-computed': 'error',
      'prettier/prettier': 'warn',
      'no-console': 'off',
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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$api/*'],
              message:
                'Importing from $api is only supported in *.routeHooks.{js,ts} files',
            },
          ],
        },
      ],
    },
  },
  // React hooks rules for JSX/TSX files (excluding api)
  {
    files: ['**/*.tsx', '**/*.js', '**/*.jsx'],
    ignores: ['api/src/**'],
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  // TypeScript-specific configuration
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        JSX: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,

      // TODO: look into enabling these eventually
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/prefer-function-type': 'off',

      // Specific 'recommended' rules we alter
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      // Disable base rule as it conflicts with @typescript-eslint/no-unused-vars
      'no-unused-vars': 'off',
    },
  },
  // Test files
  {
    files: [
      '**/*.test.*',
      '**/__mocks__/**',
      '**/*.scenarios.*',
      '**/*.stories.*',
      '**/*.mock.*',
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
        // Cedar test globals
        mockCurrentUser: 'readonly',
        defineScenario: 'readonly',
        scenario: 'readonly',
        describeScenario: 'readonly',
        mockGraphQLQuery: 'readonly',
        mockGraphQLMutation: 'readonly',
      },
    },
  },
  // Config files
  {
    files: [
      '.babelrc.js',
      'babel.config.js',
      '.eslintrc.js',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      '**/jest.setup.js',
    ],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        ecmaVersion: 'latest',
      },
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
      sourceType: 'commonjs',
    },
  },
  // Route hooks and entry server - allow $api imports
  {
    files: [
      'web/src/**/*.routeHooks.{js,ts}',
      'web/src/entry.server.{jsx,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]
