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
var importBabelConfig = require('@cedarjs/babel-config')
var importProjectConfig = require('@cedarjs/project-config')
const rwjsPaths = (0, importProjectConfig.getPaths)()
const NODE_MODULES_PATH = importNodePath.default.join(
  rwjsPaths.base,
  'node_modules',
)
const { babelrc } = (0, importBabelConfig.getApiSideDefaultBabelConfig)()
const config = {
  // To make sure other config option which depends on rootDir use
  // correct path, for example, coverageDirectory
  rootDir: rwjsPaths.base,
  roots: [importNodePath.default.join(rwjsPaths.api.src)],
  runner: importNodePath.default.join(__dirname, '../jest-serial-runner.js'),
  testEnvironment: importNodePath.default.join(
    __dirname,
    './RedwoodApiJestEnv.js',
  ),
  globals: {
    __RWJS__TEST_IMPORTS: {
      apiSrcPath: rwjsPaths.api.src,
      tearDownCachePath: importNodePath.default.join(
        rwjsPaths.generated.base,
        'scenarioTeardown.json',
      ),
      dbSchemaPath: rwjsPaths.api.dbSchema,
    },
  },
  sandboxInjectedGlobals: ['__RWJS__TEST_IMPORTS'],
  displayName: {
    color: 'redBright',
    name: 'api',
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
  // This runs once before all tests
  globalSetup: importNodePath.default.join(__dirname, './globalSetup.js'),
  // Note this setup runs for each test file!
  setupFilesAfterEnv: [
    importNodePath.default.join(__dirname, './jest.setup.js'),
  ],
  moduleNameMapper: {
    // @NOTE: Import @cedarjs/testing in api tests, and it automatically remaps to the api side only
    // This is to prevent web stuff leaking into api, and vice versa
    '^@cedarjs/testing$': importNodePath.default.join(
      NODE_MODULES_PATH,
      '@cedarjs/testing/api',
    ),
    // Support for importing files with extensions (like you'd do in ESM projects)
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      // When jest runs tests in parallel, it serializes the config before passing down options to babel
      // that's why these must be serializable. So ideally, we should just pass reference to a
      // configFile or "extends" a config. But we need a few other option only at root level, so we'll pass
      //  here and remove those keys inside "extend"ed config.
      {
        babelrc,
        // babelrc can not reside inside "extend"ed config, that's why we have it here
        configFile: importNodePath.default.resolve(
          __dirname,
          './apiBabelConfig.js',
        ),
      },
    ],
  },
  testPathIgnorePatterns: ['.scenarios.[jt]s$'],
}
var jestPresetDefault = config
