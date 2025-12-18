// This ESLint configuration is used by Cedar projects through ./index.mjs
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
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import cedarjsPlugin from '@cedarjs/eslint-plugin'

export default [
  // Base recommended config
  js.configs.recommended,

  // React recommended config, with jsx-runtime for React 17+
  reactPlugin.configs.flat.recommended,
  // This could be enabled, because we're using React >=17, but the
  // old config didn't have this
  // reactPlugin.configs.flat['jsx-runtime'],

  // Prettier plugin recommended config (runs Prettier as an ESLint rule)
  // TODO: In a future major version, switch to eslint-config-prettier and run Prettier separately
  // for better performance. This is a breaking change because it changes the workflow from
  // "eslint --fix" doing formatting to requiring "prettier --write" as a separate step.
  // See: https://prettier.io/docs/en/integrating-with-linters.html
  prettierRecommended,

  // Base configuration
  {
    plugins: {
      '@babel': babelPlugin,
      import: importPlugin,
      'jsx-a11y': jsxA11yPlugin,
      'react-hooks': reactHooksPlugin,
      '@cedarjs': cedarjsPlugin,
    },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
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
      '@cedarjs/process-env-computed': 'error',
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
  // TypeScript-specific overrides
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    // Sets the plugin for '@typescript-eslint' etc
    ...tseslint.configs.base,
    languageOptions: {
      ...tseslint.configs.base.languageOptions,
      globals: {
        // This is probably too lenient. api/ side TS files shouldn't have
        // browser globals available
        ...globals.browser,
        JSX: 'readonly',
      },
    },
    rules: {
      ...tseslint.configs.eslintRecommended.rules,
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
    // Jest DOM recommended config
    ...jestDomPlugin.configs['flat/recommended'],
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
