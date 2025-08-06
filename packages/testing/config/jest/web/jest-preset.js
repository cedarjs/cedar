'use strict'
var __create = Object.create
var __defProp = Object.defineProperty
var __getOwnPropDesc = Object.getOwnPropertyDescriptor
var __getOwnPropNames = Object.getOwnPropertyNames
var __getProtoOf = Object.getPrototypeOf
var __hasOwnProp = Object.prototype.hasOwnProperty
var __export = (target, all) => {
  for (var name in all) {
    __defProp(target, name, { get: all[name], enumerable: true })
  }
}
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from)) {
      if (!__hasOwnProp.call(to, key) && key !== except) {
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        })
      }
    }
  }
  return to
}
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, 'default', { value: mod, enumerable: true })
      : target,
    mod,
  )
)
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, '__esModule', { value: true }), mod)
var jestPresetExports = {}
__export(jestPresetExports, {
  default: () => jestPresetDefault,
})
module.exports = __toCommonJS(jestPresetExports)
var importNodePath = __toESM(require('node:path'), 1)
var importProjectConfig = require('@cedarjs/project-config')
const rwjsPaths = (0, importProjectConfig.getPaths)()
const NODE_MODULES_PATH = importNodePath.default.join(
  rwjsPaths.base,
  'node_modules',
)
const config = {
  // To make sure other config option which depends on rootDir always
  // use correct path, for example, coverageDirectory
  rootDir: rwjsPaths.base,
  roots: [importNodePath.default.join(rwjsPaths.web.src)],
  testEnvironment: importNodePath.default.join(
    __dirname,
    './RedwoodWebJestEnv.js',
  ),
  displayName: {
    color: 'blueBright',
    name: 'web',
  },
  globals: {
    __RWJS_TESTROOT_DIR: importNodePath.default.join(rwjsPaths.web.src),
    // used in jest setup to load mocks
    RWJS_ENV: {
      RWJS_API_URL: '',
      RWJS_API_GRAPHQL_URL: '/',
      __REDWOOD__APP_TITLE: 'Redwood App',
    },
    RWJS_DEBUG_ENV: {
      RWJS_SRC_ROOT: rwjsPaths.web.src,
    },
  },
  collectCoverageFrom: [
    '**/*.{js,jsx,ts,tsx}',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: importNodePath.default.join(rwjsPaths.base, 'coverage'),
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
  setupFilesAfterEnv: [
    importNodePath.default.resolve(__dirname, './jest.setup.js'),
  ],
  moduleNameMapper: {
    /**
     * Make sure modules that require different versions of these
     * dependencies end up using the same one.
     */
    '^react$': importNodePath.default.join(NODE_MODULES_PATH, 'react'),
    '^react-dom$': importNodePath.default.join(NODE_MODULES_PATH, 'react-dom'),
    '^@apollo/client/react$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@apollo/client/react',
    ),
    // We replace imports to "@cedarjs/router" with our own "mock" implementation.
    '^@cedarjs/router$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/dist/cjs/web/MockRouter.js',
    ),
    '^@cedarjs/web$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@cedarjs/web/dist/cjs',
    ),
    // This allows us to mock `createAuthentication` which is used by auth
    // clients, which in turn lets us mock `useAuth` in tests
    '^@cedarjs/auth$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/dist/cjs/web/mockAuth.js',
    ),
    // @NOTE: Import @cedarjs/testing in web tests, and it automatically remaps to the web side only
    // This is to prevent web stuff leaking into api, and vice versa
    '^@cedarjs/testing$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/web',
    ),
    '~__REDWOOD__USER_ROUTES_FOR_MOCK': rwjsPaths.web.routes,
    '~__REDWOOD__USER_AUTH_FOR_MOCK': importNodePath.default.join(
      rwjsPaths.web.src,
      'auth',
    ),
    /**
     * Mock out files that aren't particularly useful in tests. See fileMock.js for more info.
     */
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|css)$':
      '@cedarjs/testing/dist/web/fileMock.js',
    // Support for importing files with extensions (like you'd do in ESM projects)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      // When jest runs tests in parallel, it serializes the config before passing down options to babel
      // that's why these must be serializable. Passing the reference to a config instead.
      {
        configFile: importNodePath.default.resolve(
          __dirname,
          './webBabelConfig.js',
        ),
      },
    ],
  },
  resolver: importNodePath.default.resolve(__dirname, './resolver.js'),
  testPathIgnorePatterns: ['.(stories|mock).[jt]sx?$'],
}
var jestPresetDefault = config
