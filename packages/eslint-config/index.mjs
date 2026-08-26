// This is the ESLint configuration used by Cedar projects.
// Shared eslint config (projects and framework) is located in ./shared.mjs
// Framework main config is in monorepo root ./eslint.config.js

import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

import cedarjsPlugin from '@cedarjs/eslint-plugin'
import { getConfig } from '@cedarjs/project-config'

import sharedConfigs from './shared.mjs'

// Note: This config is async to support getConfig()
/** @returns {Promise<import('eslint').Linter.FlatConfig[]>} */
export default async function createConfig() {
  const config = await getConfig()

  const plugins = {}
  const rules = {}

  // Add react compiler plugin & rules if enabled
  const reactCompilerEnabled =
    config.experimental?.reactCompiler?.enabled ?? false
  if (reactCompilerEnabled) {
    const { default: reactCompilerPlugin } =
      await import('eslint-plugin-react-compiler')
    plugins['react-compiler'] = reactCompilerPlugin
    rules['react-compiler/react-compiler'] = 2
  }

  const configs = [
    ...sharedConfigs,
    {
      ignores: ['!.storybook/'],
    },
    {
      files: ['**/*.js', '**/*.jsx'],
      plugins,
      rules,
    },
  ]

  // Add jsx-a11y if enabled
  if (config.web.a11y) {
    configs.push({
      plugins: {
        'jsx-a11y': jsxA11yPlugin,
      },
      rules: {
        ...jsxA11yPlugin.configs.recommended.rules,
      },
    })
  }

  // Routes.js/jsx/tsx specific config
  configs.push({
    files: ['web/src/Routes.js', 'web/src/Routes.jsx', 'web/src/Routes.tsx'],
    rules: {
      'no-undef': 'off',
      'jsx-a11y/aria-role': [
        2,
        {
          ignoreNonDOM: true,
        },
      ],
      '@cedarjs/unsupported-route-components': 'error',
    },
  })

  // API side configuration
  configs.push({
    files: ['api/src/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        gql: 'readonly',
        context: 'readonly',
      },
      sourceType: 'module',
    },
  })

  // API services type annotations
  configs.push({
    files: ['api/src/services/**/*.ts'],
    plugins: {
      '@cedarjs': cedarjsPlugin,
    },
    rules: {
      '@cedarjs/service-type-annotations': 'off',
    },
  })

  // Seed and scripts
  configs.push({
    files: ['api/db/seed.js', 'scripts/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
      sourceType: 'commonjs',
    },
  })

  // Web side configuration
  configs.push({
    files: ['web/src/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
        gql: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
      sourceType: 'module',
    },
  })

  // Cell type annotations. The rule requires both the `*Cell.tsx` filename
  // convention and a QUERY/FRAGMENT export alongside a Success export before
  // it treats a file as a Cell. `.jsx` is excluded: it's plain
  // JavaScript-project output with no build step that strips TypeScript
  // syntax, so the rule's fixes don't apply there.
  configs.push({
    files: ['web/src/**/*Cell.tsx'],
    plugins: {
      '@cedarjs': cedarjsPlugin,
    },
    rules: {
      '@cedarjs/cell-type-annotations': 'off',
    },
  })

  // Test, stories, scenarios, and mock files
  configs.push({
    files: [
      '**/*.test.*',
      '**/__mocks__/**',
      '**/*.scenarios.*',
      '**/*.stories.*',
      '**/*.mock.*',
    ],
    languageOptions: {
      globals: {
        mockGraphQLQuery: 'readonly',
        mockGraphQLMutation: 'readonly',
        mockCurrentUser: 'readonly',
        scenario: 'readonly',
        defineScenario: 'readonly',
      },
    },
  })

  return configs
}
