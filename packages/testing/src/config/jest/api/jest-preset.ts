import path from 'node:path'

import type { Config } from 'jest'

import { getApiSideDefaultBabelConfig } from '@cedarjs/babel-config'
import { getPaths } from '@cedarjs/project-config'

const rwjsPaths = getPaths()
const { babelrc } = getApiSideDefaultBabelConfig()

/**
 * Resolve a specifier through the package's `exports` map.
 *
 * This mapping used to be built by joining onto `<project>/node_modules`, which
 * assumes every package is hoisted to one directory at the project root. yarn
 * and npm hoist, but pnpm nests, so that path often doesn't exist and the
 * mapping pointed at nothing. Resolving works under all three, and doesn't
 * require a `node_modules` directory to exist at all — which is what Yarn PnP
 * needs.
 *
 * Returns undefined when the package isn't installed or doesn't export the
 * subpath, in which case we drop the mapping and let Jest resolve the import
 * normally. That beats pointing it at a path that isn't there.
 */
function resolveSubpath(specifier: string): string | undefined {
  try {
    return require.resolve(specifier, {
      paths: [rwjsPaths.api.base, rwjsPaths.base],
    })
  } catch {
    return undefined
  }
}

const testingApiPath = resolveSubpath('@cedarjs/testing/api')

const config: Config = {
  // To make sure other config option which depends on rootDir use
  // correct path, for example, coverageDirectory
  rootDir: rwjsPaths.base,
  roots: [path.join(rwjsPaths.api.src)],
  runner: path.join(__dirname, '../jest-serial-runner.js'),
  testEnvironment: path.join(__dirname, './RedwoodApiJestEnv.js'),
  globals: {
    __CEDARJS__TEST_IMPORTS: {
      apiSrcPath: rwjsPaths.api.src,
      tearDownCachePath: path.join(
        rwjsPaths.generated.base,
        'scenarioTeardown.json',
      ),
    },
  },
  sandboxInjectedGlobals: ['__CEDARJS__TEST_IMPORTS'],
  displayName: {
    color: 'redBright',
    name: 'api',
  },
  collectCoverageFrom: [
    '**/*.{js,jsx,ts,tsx,mts,cts}',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: path.join(rwjsPaths.base, 'coverage'),
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
  // This runs once before all tests
  globalSetup: path.join(__dirname, './globalSetup.js'),
  // Note this setup runs for each test file!
  setupFilesAfterEnv: [path.join(__dirname, './jest.setup.js')],
  moduleNameMapper: {
    '^api/(.*)$': path.join(rwjsPaths.base, 'api/$1'),
    '^src/(.*)$': path.join(rwjsPaths.api.src, '$1'),
    // @NOTE: Import @cedarjs/testing in api tests, and it automatically remaps to the api side only
    // This is to prevent web stuff leaking into api, and vice versa
    ...(testingApiPath ? { '^@cedarjs/testing$': testingApiPath } : {}),
    // Support for importing files with extensions (like you'd do in ESM projects)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '\\.[cm]?[jt]sx?$': [
      'babel-jest',
      // When jest runs tests in parallel, it serializes the config before passing down options to babel
      // that's why these must be serializable. So ideally, we should just pass reference to a
      // configFile or "extends" a config. But we need a few other option only at root level, so we'll pass
      //  here and remove those keys inside "extend"ed config.
      {
        babelrc, // babelrc can not reside inside "extend"ed config, that's why we have it here
        configFile: path.resolve(__dirname, './apiBabelConfig.js'),
      },
    ],
  },
  testPathIgnorePatterns: ['.scenarios.[jt]s$'],
}

export default config
