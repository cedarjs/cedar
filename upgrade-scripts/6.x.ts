import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { parse as parseYaml } from 'yaml'

import { getPaths } from '@cedarjs/project-config'
import { getPackageManager } from '@cedarjs/project-config/packageManager'

const projectPaths = getPaths()
const projectRoot = projectPaths.base

const patterns = [
  '**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
  '**/*.json',
  '**/*.{yaml,yml}',
  '**/*.sh',
]

const exclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.cedar/**',
  '**/.redwood/**',
  '**/web/public/**',
]

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  resolutions?: Record<string, string>
  overrides?: Record<string, string>
  pnpm?: {
    overrides?: Record<string, string>
  }
}

/**
 * Returns the value of the top-level `overrides.vite` entry in a
 * pnpm-workspace.yaml, or undefined if there isn't one (or the yaml doesn't
 * parse)
 */
function getPnpmWorkspaceViteOverride(yamlContent: string) {
  let parsed: unknown

  try {
    parsed = parseYaml(yamlContent)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || !('overrides' in parsed)) {
    return undefined
  }

  const overrides: unknown = parsed.overrides

  if (!overrides || typeof overrides !== 'object' || !('vite' in overrides)) {
    return undefined
  }

  const vite: unknown = overrides.vite

  return typeof vite === 'string' ? vite : undefined
}

function warn(title: string, lines: string[]) {
  console.log(util.styleText('yellow', title) + '\n')

  for (const line of lines) {
    console.log(line + '\n')
  }
}

async function main() {
  const filesWithGetCommonPlugins: string[] = []
  const filesWithNodePolyfills: string[] = []
  const filesWithGraphQLHooksProvider: string[] = []
  const filesWithRemovedGraphQLTypes: string[] = []
  const filesWithContextWrapping: string[] = []
  const filesWithMswImports: string[] = []
  const filesWithWhatwgFetch: string[] = []

  const removedGraphQLTypesRegex =
    /\b(QueryOperationResult|MutationOperationResult|GraphQLQueryHookOptions|GraphQLMutationHookOptions|GraphQLOperationVariables)\b/
  const mswImportRegex = /(from\s+['"]|require\(['"])msw(['"]|\/)/

  for await (const file of fs.promises.glob(patterns, {
    cwd: projectRoot,
    exclude,
  })) {
    const content = await fs.promises.readFile(
      path.join(projectRoot, file),
      'utf8',
    )

    if (content.includes('getCommonPlugins')) {
      filesWithGetCommonPlugins.push(file)
    }

    if (content.includes('cedarNodePolyfills')) {
      filesWithNodePolyfills.push(file)
    }

    if (content.includes('GraphQLHooksProvider')) {
      filesWithGraphQLHooksProvider.push(file)
    }

    if (removedGraphQLTypesRegex.test(content)) {
      filesWithRemovedGraphQLTypes.push(file)
    }

    if (
      content.includes('ContextWrapping') ||
      content.includes('context-wrapping')
    ) {
      filesWithContextWrapping.push(file)
    }

    if (mswImportRegex.test(content)) {
      filesWithMswImports.push(file)
    }

    if (content.includes('whatwg-fetch')) {
      filesWithWhatwgFetch.push(file)
    }
  }

  if (filesWithGraphQLHooksProvider.length > 0) {
    warn('Removed API detected: GraphQLHooksProvider', [
      'Found GraphQLHooksProvider in: ' +
        filesWithGraphQLHooksProvider.join(', '),
      'GraphQLHooksProvider has been removed from @cedarjs/web in v6. Cells\n' +
        'and the hooks exported from @cedarjs/web now use Apollo directly.\n' +
        'Apps that used GraphQLHooksProvider to plug in a non-Apollo GraphQL\n' +
        'client must switch to Apollo (CedarApolloProvider or a custom\n' +
        'ApolloProvider setup).',
    ])
  }

  if (filesWithRemovedGraphQLTypes.length > 0) {
    warn('Removed global GraphQL types detected', [
      'Found usage in: ' + filesWithRemovedGraphQLTypes.join(', '),
      'The ambient global types QueryOperationResult,\n' +
        'MutationOperationResult, GraphQLQueryHookOptions,\n' +
        'GraphQLMutationHookOptions and GraphQLOperationVariables have been\n' +
        'removed in v6. Import the equivalent types (QueryResult,\n' +
        'MutationTuple, QueryHookOptions, MutationHookOptions,\n' +
        'OperationVariables) from @apollo/client instead.',
    ])
  }

  if (filesWithNodePolyfills.length > 0) {
    warn('Removed export detected: cedarNodePolyfills', [
      'Found cedarNodePolyfills in: ' + filesWithNodePolyfills.join(', '),
      'cedarNodePolyfills has been removed from @cedarjs/vite in v6. It\n' +
        'only existed to support the dev fatal error page, and has been\n' +
        'replaced by the much lighter cedarDataUriShim. If you compose your\n' +
        'own vite plugin pipeline, swap cedarNodePolyfills() for\n' +
        'cedarDataUriShim().',
      'The dev server also no longer injects a global Buffer polyfill into\n' +
        'web-side code. If you relied on Buffer in the browser, add\n' +
        'vite-plugin-node-polyfills to your own web/vite.config.ts (unlike\n' +
        'the old polyfill, that also works in production builds).',
    ])
  }

  if (filesWithGetCommonPlugins.length > 0) {
    warn('Removed export detected: getCommonPlugins', [
      'Found getCommonPlugins in: ' + filesWithGetCommonPlugins.join(', '),
      'getCommonPlugins has been removed from @cedarjs/babel-config in v6.\n' +
        'It has returned an empty array for a long time, so just delete the\n' +
        'import and any ...getCommonPlugins() usage. No replacement is\n' +
        'needed.',
    ])
  }

  if (filesWithContextWrapping.length > 0) {
    warn('Renamed plugin detected: context-wrapping', [
      'Found context-wrapping references in: ' +
        filesWithContextWrapping.join(', '),
      'The plugin that wraps api request handlers in AsyncLocalStorage has\n' +
        'been renamed in v6:\n' +
        '  cedarContextWrappingPlugin -> handlerAlsWrappingPlugin\n' +
        '  applyContextWrapping -> applyHandlerAlsWrapping\n' +
        "  Vite plugin name 'cedar-context-wrapping' -> 'handler-als-wrapping'\n" +
        '  babel-plugin-redwood-context-wrapping ->\n' +
        '    babel-plugin-handler-als-wrapping\n' +
        'Update the references in the files listed above.',
    ])
  }

  if (filesWithMswImports.length > 0) {
    warn('Direct msw imports detected', [
      'Found msw imports in: ' + filesWithMswImports.join(', '),
      '@cedarjs/testing now uses MSW 2 (up from MSW 1). Cedar mocks like\n' +
        'mockGraphQLQuery keep working unchanged, but code that imports from\n' +
        'msw directly must be updated for the MSW 2 API (rest -> http,\n' +
        'resolvers return HttpResponse, setupWorker moved to msw/browser).',
      'See https://mswjs.io/docs/migrations/1.x-to-2.x',
    ])
  }

  if (filesWithWhatwgFetch.length > 0) {
    warn('whatwg-fetch usage detected', [
      'Found whatwg-fetch in: ' + filesWithWhatwgFetch.join(', '),
      'whatwg-fetch is no longer a dependency of @cedarjs/testing in v6. The\n' +
        'Jest test environment now provides native fetch/Request/Response, so\n' +
        'you can usually just delete the import. If you still need it, add\n' +
        'whatwg-fetch to your own devDependencies (in which case you can\n' +
        'ignore this warning).',
    ])
  }

  const webBabelConfigFiles = [
    'babel.config.js',
    'babel.config.cjs',
    'babel.config.mjs',
    'babel.config.ts',
    '.babelrc',
    '.babelrc.js',
  ]
    .map((file) => path.join(projectPaths.web.base, file))
    .filter((file) => fs.existsSync(file))
    // File-existence checks like this one work with absolute paths, but the
    // glob-based checks above print project-relative paths. Convert before
    // printing so all warnings are consistent — remember this for future
    // upgrade scripts (7.x and beyond)
    .map((file) => path.relative(projectRoot, file))

  if (webBabelConfigFiles.length > 0) {
    warn('Custom web-side Babel config detected', [
      'Found: ' + webBabelConfigFiles.join(', '),
      'As of v6 the cedar() Vite plugin no longer applies your web-side\n' +
        'Babel config file during dev and build, so custom Babel plugins and\n' +
        'presets configured there silently stop running in the browser\n' +
        'bundle. (The file is still used for Jest tests and linting.)',
      'If you rely on custom Babel plugins in your web build, pass them via\n' +
        'the new babel option in web/vite.config.ts instead:\n' +
        "  cedar({ babel: { plugins: ['my-babel-plugin'] } })",
    ])
  }

  const mockServiceWorkerPath = path.join(
    projectPaths.web.base,
    'public',
    'mockServiceWorker.js',
  )

  if (fs.existsSync(mockServiceWorkerPath)) {
    warn('Old MSW service worker detected', [
      'Found: ' + path.relative(projectRoot, mockServiceWorkerPath),
      'This file was generated by MSW 1 and is incompatible with MSW 2,\n' +
        'which Cedar v6 uses. Delete it. It will be regenerated the next\n' +
        'time you run `yarn cedar storybook`.',
    ])
  }

  const rootPackageJsonPath = path.join(projectRoot, 'package.json')

  if (fs.existsSync(rootPackageJsonPath)) {
    // Cast is safe enough here: we only do optional-chained lookups on the
    // parsed structure
    const packageJson = JSON.parse(
      await fs.promises.readFile(rootPackageJsonPath, 'utf8'),
    ) as PackageJson

    const vitestVersion =
      packageJson.devDependencies?.vitest ?? packageJson.dependencies?.vitest

    if (vitestVersion && !/^[\^~]?4\./.test(vitestVersion)) {
      warn('Vitest upgrade needed', [
        'Your project depends on vitest ' +
          vitestVersion +
          ', but Cedar v6 requires Vitest 4.',
        'Bump vitest to 4.1.10 in your root package.json after upgrading.',
        'See https://vitest.dev/guide/migration for Vitest 4 breaking\n' +
          'changes that might affect your own tests.',
      ])
    }

    const packageManager = getPackageManager()

    let vitePinValue: string | undefined
    let vitePinInstructions = ''

    if (packageManager === 'pnpm') {
      vitePinValue = packageJson.pnpm?.overrides?.vite

      const workspaceYamlPath = path.join(projectRoot, 'pnpm-workspace.yaml')

      if (!vitePinValue && fs.existsSync(workspaceYamlPath)) {
        const workspaceYaml = await fs.promises.readFile(
          workspaceYamlPath,
          'utf8',
        )
        vitePinValue = getPnpmWorkspaceViteOverride(workspaceYaml)
      }

      vitePinInstructions =
        'Add this to your pnpm-workspace.yaml:\n' +
        '  overrides:\n' +
        "    vite: '7.3.5'"
    } else if (packageManager === 'npm') {
      vitePinValue = packageJson.overrides?.vite

      vitePinInstructions =
        'Add this to your root package.json:\n' +
        '  "overrides": {\n' +
        '    "vite": "7.3.5"\n' +
        '  }'
    } else {
      vitePinValue = packageJson.resolutions?.vite

      vitePinInstructions =
        'Add this to your root package.json:\n' +
        '  "resolutions": {\n' +
        '    "vite": "7.3.5"\n' +
        '  }'
    }

    const hasCompatibleVitePin =
      !!vitePinValue && /^[\^~]?7\./.test(vitePinValue)

    if (vitestVersion && !hasCompatibleVitePin) {
      const lines = [
        'Vitest 4 pulls in its own copy of Vite 8 unless you pin vite to\n' +
          'the version Cedar uses, which makes web tests fail to parse JSX.',
        vitePinInstructions,
      ]

      if (vitePinValue) {
        lines.unshift(
          'Your project pins vite to ' +
            vitePinValue +
            ', but Cedar v6 needs Vite 7.',
        )
      }

      warn(
        vitePinValue
          ? 'Incompatible vite version pin'
          : 'Missing vite version pin',
        lines,
      )
    }
  }

  let shouldAbort = false

  const apiGeneratorTemplatesPath = path.join(
    projectPaths.api.base,
    'generators',
  )
  const webGeneratorTemplatesPath = path.join(
    projectPaths.web.base,
    'generators',
  )

  for (const generatorTemplatesPath of [
    webGeneratorTemplatesPath,
    apiGeneratorTemplatesPath,
  ]) {
    if (fs.existsSync(generatorTemplatesPath)) {
      shouldAbort = true

      console.error(
        'Unsupported generator templates path detected at ' +
          generatorTemplatesPath,
      )
      console.log()
      console.log(
        'Run `yarn dlx @cedarjs/codemods move-generator-templates` to move ' +
          'them to the new supported path',
      )
      console.log()
      console.log(
        'Please see https://github.com/cedarjs/cedar/pull/813 for more ' +
          'information.',
      )
      console.log()
    }
  }

  if (shouldAbort) {
    process.exit(1)
  }
}

main()
