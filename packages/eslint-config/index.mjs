// This is the ESLint configuration used by Cedar projects.
// Shared eslint config (projects and framework) is located in ./shared.mjs
// Framework main config is in monorepo root ./eslint.config.js

import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import reactCompilerPlugin from 'eslint-plugin-react-compiler'
import globals from 'globals'

import {
  getCommonPlugins,
  getApiSideDefaultBabelConfig,
  getWebSideDefaultBabelConfig,
} from '@cedarjs/babel-config'
import cedarjsPlugin from '@cedarjs/eslint-plugin'
import { getConfig, isTypeScriptProject } from '@cedarjs/project-config'

import sharedConfigs from './shared.mjs'

// Note: This config is async to support getConfig()
export default async function createConfig() {
  const config = await getConfig()

  const getProjectBabelOptions = () => {
    // We can't nest the web overrides inside the overrides block
    // So we just take it out and put it as a separate item
    // Ignoring overrides, as I don't think it has any impact on linting
    const { overrides: _webOverrides, ...otherWebConfig } =
      getWebSideDefaultBabelConfig({
        // We have to enable certain presets like `@babel/preset-react` for JavaScript projects
        forJavaScriptLinting: !isTypeScriptProject(),
      })

    const { overrides: _apiOverrides, ...otherApiConfig } =
      getApiSideDefaultBabelConfig()

    return {
      plugins: getCommonPlugins(),
      overrides: [
        {
          test: ['./api/', './scripts/'],
          ...otherApiConfig,
        },
        {
          test: ['./web/'],
          ...otherWebConfig,
        },
      ],
    }
  }

  const plugins = {}
  const rules = {}

  // Add react compiler plugin & rules if enabled
  const reactCompilerEnabled =
    config.experimental?.reactCompiler?.enabled ?? false
  if (reactCompilerEnabled) {
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
      languageOptions: {
        parserOptions: {
          requireConfigFile: false,
          babelOptions: getProjectBabelOptions(),
        },
      },
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
