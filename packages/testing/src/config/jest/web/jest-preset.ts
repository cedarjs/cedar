import path from 'node:path'

import type { Config } from 'jest'

import { getPaths } from '@cedarjs/project-config'

const cedarPaths = getPaths()
const NODE_MODULES_PATH = path.join(cedarPaths.base, 'node_modules')

const config: Config = {
  // To make sure other config option which depends on rootDir always
  // use correct path, for example, coverageDirectory
  rootDir: cedarPaths.base,
  roots: [path.join(cedarPaths.web.src)],
  // Opting out of jsdom's browser-style export condition resolution (needed to
  // resolve `msw/node`) is handled by the environment itself, via
  // jest-fixed-jsdom
  testEnvironment: path.join(__dirname, './RedwoodWebJestEnv.js'),
  displayName: {
    color: 'blueBright',
    name: 'web',
  },
  globals: {
    __RWJS_TESTROOT_DIR: path.join(cedarPaths.web.src), // used in jest setup to load mocks
    RWJS_ENV: {
      RWJS_API_URL: '',
      RWJS_API_GRAPHQL_URL: '/',
      __REDWOOD__APP_TITLE: 'Redwood App',
    },
    RWJS_DEBUG_ENV: {
      RWJS_SRC_ROOT: cedarPaths.web.src,
    },
  },
  collectCoverageFrom: [
    '**/*.{js,jsx,ts,tsx}',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: path.join(cedarPaths.base, 'coverage'),
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
  setupFilesAfterEnv: [path.resolve(__dirname, './jest.setup.js')],
  moduleNameMapper: {
    /**
     * Make sure modules that require different versions of these
     * dependencies end up using the same one.
     */
    '^react$': path.join(NODE_MODULES_PATH, 'react'),
    '^react-dom$': path.join(NODE_MODULES_PATH, 'react-dom'),
    // Point straight at Apollo Client's CJS build. Mapping to the package
    // directory would bypass its `exports` map and land on the ESM build,
    // and `require.resolve` can't be used either because Node 22+ resolves
    // it through the `module-sync` condition (also ESM) – both of which Jest
    // can't parse
    '^@apollo/client/react$': path.join(
      NODE_MODULES_PATH,
      '@apollo/client/__cjs/react/index.cjs',
    ),
    // We replace imports to "@cedarjs/router" with our own "mock" implementation.
    '^@cedarjs/router$': path.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/dist/cjs/web/MockRouter.js',
    ),
    '^@cedarjs/web$': path.join(NODE_MODULES_PATH, '@cedarjs/web/dist/cjs'),

    // This allows us to mock `createAuthentication` which is used by auth
    // clients, which in turn lets us mock `useAuth` in tests
    '^@cedarjs/auth$': path.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/dist/cjs/web/mockAuth.js',
    ),

    // @NOTE: Import @cedarjs/testing in web tests, and it automatically remaps to the web side only
    // This is to prevent web stuff leaking into api, and vice versa
    '^@cedarjs/testing$': path.join(NODE_MODULES_PATH, '@cedarjs/testing/web'),
    '~__CEDAR__USER_ROUTES_FOR_MOCK': cedarPaths.web.routes,
    '~__CEDAR__USER_AUTH_FOR_MOCK': path.join(cedarPaths.web.src, 'auth'),
    /**
     * Mock out files that aren't particularly useful in tests. See fileMock.js for more info.
     */
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|css)$':
      '@cedarjs/testing/dist/cjs/web/fileMock.js',
    // Support for importing files with extensions (like you'd do in ESM projects)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // MSW's CommonJS build `require`s ESM-only packages (`rettime`,
    // `@open-draft/deferred-promise` and `until-async`, which ships ESM in
    // plain `.js` files). Node supports require(esm), but Jest's runtime
    // doesn't, so compile any `.mjs` file that gets pulled in from
    // node_modules (plus until-async) to CommonJS. This needs its own
    // transform entry (with the config inlined) because the web babel config
    // ignores node_modules
    '[/\\\\]node_modules[/\\\\](?:.+\\.mjs|until-async[/\\\\].+\\.js)$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [
          [require.resolve('@babel/preset-env'), { targets: { node: '20' } }],
        ],
      },
    ],
    '\\.[jt]sx?$': [
      'babel-jest',
      // When jest runs tests in parallel, it serializes the config before passing down options to babel
      // that's why these must be serializable. Passing the reference to a config instead.
      {
        configFile: path.resolve(__dirname, './webBabelConfig.js'),
      },
    ],
  },
  // Jest's default is to not transform anything in node_modules, but `.mjs`
  // files (and until-async) have to be compiled to CommonJS (see the
  // transform above). With pnpm, msw is resolved to TypeScript source files
  // in the virtual store, so we need to allow transformation for msw.
  transformIgnorePatterns: [
    // Standard node_modules, but allow .mjs and until-async
    '[/\\\\]node_modules[/\\\\](?!.*\\.mjs$)(?!until-async[/\\\\])',
    // pnpm virtual store, but allow msw (resolved to TS source)
    '[/\\\\]node_modules[/\\\\]\\.pnpm[/\\\\](?!msw@)',
    // yarn PnP
    '\\.pnp\\.[^\\\\/]+$',
  ],
  resolver: path.resolve(__dirname, './resolver.js'),
  testPathIgnorePatterns: ['.(stories|mock).[jt]sx?$'],
}

export default config
