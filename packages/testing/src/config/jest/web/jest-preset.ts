import fs from 'node:fs'
import path from 'node:path'

import type { Config } from 'jest'

import { getPaths } from '@cedarjs/project-config'

const cedarPaths = getPaths()

// Where to resolve the packages below from. The web side first, because that's
// where a web test's dependencies are declared, then the project root for
// things only the root depends on (`@cedarjs/testing`). Node walks up from
// each of these, so this covers yarn/npm's hoisted layout too
const RESOLVE_FROM = [cedarPaths.web.base, cedarPaths.base]

/**
 * Find the directory a package was installed into.
 *
 * These mappings used to be built by joining paths onto
 * `<project>/node_modules`, which assumes every package is hoisted to a single
 * directory at the project root. yarn and npm do hoist, but pnpm nests: `react`
 * lives in `web/node_modules/react`, and the project root only holds what the
 * root package.json itself depends on. So those mappings pointed at paths that
 * don't exist and every web test failed to run under pnpm.
 *
 * Resolving instead of assuming works under all three, and doesn't require a
 * `node_modules` directory to exist at all — which is what Yarn PnP needs.
 *
 * Returns undefined if the package isn't installed, in which case the caller
 * should drop the mapping and let Jest resolve the import normally. That's
 * always better than mapping it to a path that isn't there.
 */
function resolvePackageDir(
  packageName: string,
  resolveFrom: string[] = RESOLVE_FROM,
): string | undefined {
  try {
    // Most packages expose ./package.json, and it's the cheapest way to the
    // package root
    return path.dirname(
      require.resolve(`${packageName}/package.json`, { paths: resolveFrom }),
    )
  } catch {
    // Not exposed through the package's `exports` map — fall through
  }

  try {
    let dir = path.dirname(require.resolve(packageName, { paths: resolveFrom }))

    // Walk up from the entry point until we find the package's own manifest
    for (;;) {
      const manifestPath = path.join(dir, 'package.json')

      if (fs.existsSync(manifestPath)) {
        const manifest: unknown = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8'),
        )

        if (
          manifest &&
          typeof manifest === 'object' &&
          'name' in manifest &&
          manifest.name === packageName
        ) {
          return dir
        }
      }

      const parent = path.dirname(dir)

      if (parent === dir) {
        return undefined
      }

      dir = parent
    }
  } catch {
    return undefined
  }
}

/**
 * Path to a file (or subdirectory) inside an installed package. Deliberately
 * resolves the package root and then joins, rather than resolving the subpath
 * directly, so that an `exports` map can't block or redirect it — the mapping
 * that uses this points at internal build output the package doesn't export.
 */
function packagePath(
  packageName: string,
  relativePath = '',
  resolveFrom: string[] = RESOLVE_FROM,
) {
  const packageDir = resolvePackageDir(packageName, resolveFrom)

  return packageDir && path.join(packageDir, relativePath)
}

/**
 * Resolve a specifier through the package's `exports` map, which is how the
 * rest of the world imports it. Preferred over `packagePath` wherever the
 * package exports what we need: it doesn't hard-code the package's internal
 * build layout, and the `require` condition gets us the CJS build Jest wants.
 *
 * Returns undefined when the package isn't installed or doesn't export the
 * subpath, in which case the caller drops the mapping.
 */
function resolveSubpath(
  specifier: string,
  resolveFrom: string[] = RESOLVE_FROM,
): string | undefined {
  try {
    return require.resolve(specifier, { paths: resolveFrom })
  } catch {
    return undefined
  }
}

// `@cedarjs/web`'s own directory, so its dependencies can be resolved the way
// it would resolve them. Falls back to the normal list if it isn't installed
const cedarWebDir = resolvePackageDir('@cedarjs/web')
const cedarWebResolveFrom = cedarWebDir
  ? [cedarWebDir, ...RESOLVE_FROM]
  : RESOLVE_FROM

function definedEntries(mappings: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(mappings).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

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
    ...definedEntries({
      /**
       * Make sure modules that require different versions of these
       * dependencies end up using the same one.
       */
      '^react$': resolveSubpath('react'),
      '^react-dom$': resolveSubpath('react-dom'),
      // Point straight at Apollo Client's CJS build. Resolving the subpath
      // would go through its `exports` map and land on the ESM build (Node 22+
      // picks the `module-sync` condition), which Jest can't parse.
      // Resolved starting from `@cedarjs/web` because that's what depends on
      // Apollo — a project doesn't declare it itself, so under pnpm it isn't
      // reachable from the web side at all, and searching from there finds
      // either nothing or some unrelated copy pulled in by another dependency
      '^@apollo/client/react$': packagePath(
        '@apollo/client',
        '__cjs/react/index.cjs',
        cedarWebResolveFrom,
      ),
      // We replace imports to "@cedarjs/router" with our own "mock" implementation.
      '^@cedarjs/router$': resolveSubpath('@cedarjs/testing/web/MockRouter.js'),
      '^@cedarjs/web$': resolveSubpath('@cedarjs/web'),

      // This allows us to mock `createAuthentication` which is used by auth
      // clients, which in turn lets us mock `useAuth` in tests
      '^@cedarjs/auth$': resolveSubpath('@cedarjs/testing/auth'),

      // @NOTE: Import @cedarjs/testing in web tests, and it automatically remaps to the web side only
      // This is to prevent web stuff leaking into api, and vice versa
      '^@cedarjs/testing$': resolveSubpath('@cedarjs/testing/web'),
      /**
       * Mock out files that aren't particularly useful in tests. See fileMock.js for more info.
       */
      '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|css)$':
        resolveSubpath('@cedarjs/testing/dist/cjs/web/fileMock.js'),
    }),
    '~__CEDAR__USER_ROUTES_FOR_MOCK': cedarPaths.web.routes,
    '~__CEDAR__USER_AUTH_FOR_MOCK': path.join(cedarPaths.web.src, 'auth'),
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
  // transform above).
  // The `.pnpm` lookahead is what makes this work with pnpm: its virtual store
  // puts packages at `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`,
  // so without it the pattern matches (and thereby ignores) at the *first*
  // `node_modules` segment, where the following path starts with `.pnpm/`
  // instead of `until-async/` and the exception never gets a chance to apply.
  // Skipping that segment forces the match onto the inner `node_modules`,
  // which looks the same as a hoisted npm/yarn layout
  transformIgnorePatterns: [
    '[/\\\\]node_modules[/\\\\](?!\\.pnpm[/\\\\])(?!.*\\.mjs$)(?!until-async[/\\\\])',
    '\\.pnp\\.[^\\\\/]+$',
  ],
  resolver: path.resolve(__dirname, './resolver.js'),
  testPathIgnorePatterns: ['.(stories|mock).[jt]sx?$'],
}

export default config
