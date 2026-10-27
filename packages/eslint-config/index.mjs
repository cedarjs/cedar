// This is the ESLint configuration used by Cedar projects.
// Shared eslint config (projects and framework) is located in ./shared.mjs
// Framework main config is in monorepo root ./eslint.config.js

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as graphqlPlugin from '@graphql-eslint/eslint-plugin'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

import cedarjsPlugin from '@cedarjs/eslint-plugin'
import { getConfig, getPaths } from '@cedarjs/project-config'

import sharedConfigs from './shared.mjs'

/**
 * Components from `@cedarjs/forms` (see packages/forms/src/index.tsx) that
 * render an `<input>`, `<select>` or `<textarea>` a `<label>` can be
 * associated with. `HiddenField` is left out because hidden inputs can't be
 * labelled.
 */
const cedarFormsControlComponents = [
  'ButtonField',
  'CheckboxField',
  'ColorField',
  'DateField',
  'DatetimeLocalField',
  'EmailField',
  'FileField',
  'ImageField',
  'InputField',
  'MonthField',
  'NumberField',
  'PasswordField',
  'RadioField',
  'RangeField',
  'ResetField',
  'SearchField',
  'SelectField',
  'SubmitField',
  'TelField',
  'TextAreaField',
  'TextField',
  'TimeField',
  'UrlField',
  'WeekField',
]

function toPosixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join(path.posix.sep)
}

/**
 * Lints the GraphQL documents (`gql` tagged templates) on the web side
 * against the app's schema.
 *
 * `@graphql-eslint/require-selections` requires every selection of an object
 * type that has an `id` to select that `id`. Apollo's InMemoryCache can only
 * normalize objects it knows the `id` of. Two queries that select the same
 * object, one with its `id` and one without, overwrite each other's copy in
 * the cache and refetch each other, which nothing else (GraphQL validation,
 * type generation, tests) reports.
 *
 * The schema is `.cedar/schema.graphql`, which `yarn cedar generate types`
 * and `yarn cedar dev` write, and `yarn cedar lint` when it's missing. It's
 * a generated, git-ignored file, so it's missing on a fresh clone. The rule
 * can't run without a schema, so when ESLint runs on its own (in an editor,
 * say) these configs are left out until the schema has been generated.
 *
 * @returns {import('eslint').Linter.FlatConfig[]}
 */
function createWebGraphQLConfigs() {
  const paths = getPaths()

  if (!fs.existsSync(paths.generated.schema)) {
    return []
  }

  // Flat config `files` globs are matched relative to the project root,
  // with forward slashes on every platform
  const webSrc = toPosixRelative(paths.base, paths.web.src)

  // The parser resolves its schema and documents pointers relative to the
  // working directory. They're given relative, not absolute: graphql-tools
  // tries to parse a pointer with a space in it as a GraphQL document, and
  // fails, when the project's path has one
  const cwd = process.cwd()

  return [
    {
      // Extracts every gql`` document into a virtual
      // `<file>/<n>_document.graphql` file, linted by the config below. The
      // file itself is linted as usual
      files: [`${webSrc}/**/*.{js,jsx,ts,tsx}`],
      processor: graphqlPlugin.processors.graphql,
    },
    {
      files: [`${webSrc}/**/*.graphql`],
      languageOptions: {
        parser: graphqlPlugin.parser,
        parserOptions: {
          graphQLConfig: {
            schema: toPosixRelative(cwd, paths.generated.schema),
            // Needed to resolve fragment spreads, so a spread of a fragment
            // defined in another file (a fragment Cell's FRAGMENT, say) is
            // checked too. Only JS and TS: like the build and type
            // generation, Cedar has no .graphql documents on the web side
            documents: `${toPosixRelative(cwd, paths.web.src)}/**/*.{js,jsx,ts,tsx}`,
          },
        },
      },
      plugins: {
        '@graphql-eslint': graphqlPlugin,
      },
      rules: {
        '@graphql-eslint/require-selections': 'error',
      },
    },
  ]
}

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
        // The rule only recognizes native controls by tag name, so it can't
        // tell that a nested `<TextField />` renders an `<input>`
        'jsx-a11y/label-has-associated-control': [
          'error',
          {
            controlComponents: cedarFormsControlComponents,
          },
        ],
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

  configs.push(...createWebGraphQLConfigs())

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
