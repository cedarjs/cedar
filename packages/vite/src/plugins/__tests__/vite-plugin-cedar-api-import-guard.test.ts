import path from 'node:path'

import { build, createServer, normalizePath, resolveConfig } from 'vite'
import type { PluginOption, ViteDevServer } from 'vite'
import tsPathsMod from 'vite-tsconfig-paths'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cedarApiImportGuardPlugin } from '../vite-plugin-cedar-api-import-guard.js'
import { cedarjsResolveCedarStyleImportsPlugin } from '../vite-plugin-cedarjs-resolve-cedar-style-imports.js'

// vite-tsconfig-paths is ESM-only, and CJS builds double-wrap its default
// export. Same interop dance as in src/index.ts
const tsconfigPaths =
  // @ts-expect-error – .default only exists at runtime in CJS double-wrap
  // interop
  tsPathsMod.default?.default || tsPathsMod.default || tsPathsMod

const rootDir = path.join(__dirname, '__fixtures__', 'dollar-api-imports')
const webDir = path.join(rootDir, 'web')
const importer = path.join(webDir, 'src', 'pages', 'dollarApiImport.ts')
// The plugin normalizes what it returns, so that Vite gets forward-slash paths
// on Windows too
const dbPath = normalizePath(path.join(rootDir, 'api', 'src', 'lib', 'db.ts'))
const servicePath = normalizePath(
  path.join(rootDir, 'api', 'src', 'services', 'posts', 'posts.ts'),
)

// Spinning up Vite dev servers is slow on Windows CI runners
const TIMEOUT = 30_000

/** The plugin setups the tests resolve `$api/src/lib/db` through */
const PLUGIN_SETUPS = {
  /** Just the resolve plugin, to check what it does on its own */
  resolve: () => [cedarjsResolveCedarStyleImportsPlugin()],
  /** What a Cedar project gets, in the order cedar() sets them up in */
  cedar: () => [
    cedarApiImportGuardPlugin(),
    tsconfigPaths(),
    cedarjsResolveCedarStyleImportsPlugin(),
  ],
} satisfies Record<string, () => PluginOption[]>

// Dependency scanning is pure overhead here – the tests only ever resolve a
// single id – and it's the slowest part of starting a server on CI
const NO_DEP_SCAN = { noDiscovery: true, include: [] }

type PluginSetup = keyof typeof PLUGIN_SETUPS

// Starting a server per test is too slow, so they're started on demand and
// shared between all tests that use the same plugin setup
const servers = new Map<PluginSetup, Promise<ViteDevServer>>()

let originalCedarCwd: string | undefined

beforeAll(() => {
  // The $api/ resolution needs getPaths() to find a project root
  originalCedarCwd = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = rootDir
})

afterAll(async () => {
  await Promise.all(
    [...servers.values()].map(async (server) => (await server).close()),
  )

  if (originalCedarCwd === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = originalCedarCwd
  }
})

function getServer(setup: PluginSetup) {
  let server = servers.get(setup)

  if (!server) {
    server = createServer({
      root: webDir,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: NO_DEP_SCAN,
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: PLUGIN_SETUPS[setup](),
    })

    servers.set(setup, server)
  }

  return server
}

/**
 * Resolves `$api/src/lib/db` in the given Vite environment, using the given
 * plugin setup
 */
async function resolveInEnvironment(
  environmentName: 'client' | 'ssr',
  setup: PluginSetup,
  id = '$api/src/lib/db',
) {
  const server = await getServer(setup)
  const environment = server.environments[environmentName]
  const resolved = await environment.pluginContainer.resolveId(id, importer)

  return resolved?.id ?? null
}

describe('$api imports in the client environment', () => {
  it(
    'throws when a client module imports $api',
    async () => {
      // The web side's tsconfig.json maps `$api/*` to `../api/*`, so
      // vite-tsconfig-paths resolves $api imports all on its own. The guard
      // plugin has to run before it to be of any use
      await expect(resolveInEnvironment('client', 'cedar')).rejects.toThrow(
        /Cannot import "\$api\/src\/lib\/db" from client-side/,
      )
    },
    TIMEOUT,
  )

  it(
    'mentions the importer in the error message',
    async () => {
      await expect(resolveInEnvironment('client', 'cedar')).rejects.toThrow(
        /dollarApiImport\.ts/,
      )
    },
    TIMEOUT,
  )

  it(
    'fails the client build',
    async () => {
      await expect(
        build({
          root: webDir,
          configFile: false,
          logLevel: 'silent',
          optimizeDeps: NO_DEP_SCAN,
          plugins: PLUGIN_SETUPS.cedar(),
          build: {
            lib: { entry: importer, formats: ['es'] },
            write: false,
            minify: false,
          },
        }),
      ).rejects.toThrow(/Cannot import "\$api\/src\/lib\/db" from client-side/)
    },
    TIMEOUT,
  )

  it(
    'does not resolve $api imports without the tsconfig paths mapping',
    async () => {
      // Without the guard plugin, the import is left unresolved by
      // cedarjsResolveCedarStyleImportsPlugin, and Vite reports its regular
      // "Failed to resolve import" error
      const resolved = await resolveInEnvironment('client', 'resolve')

      expect(resolved).toBe(null)
    },
    TIMEOUT,
  )
})

describe('plugin ordering', () => {
  it(
    'runs before the plugins buildApp() adds on top of the project config',
    async () => {
      // buildApp() (`cedar build`, and `cedar build --ud`) starts its own
      // plugin list with tsconfigPaths(), and passes it as inline config on
      // top of the project's web/vite.config.ts – the one calling cedar().
      // Vite puts config file plugins before inline ones, so the guard still
      // gets to see $api imports first
      const resolved = await resolveConfig(
        {
          root: webDir,
          configFile: path.join(webDir, 'vite.config.ts'),
          logLevel: 'silent',
          plugins: [tsconfigPaths()],
        },
        'build',
      )

      const names = resolved.plugins.map((plugin) => plugin.name)
      const guardIndex = names.indexOf('cedar-api-import-guard')
      const tsconfigPathsIndex = names.indexOf('vite-tsconfig-paths')

      expect(guardIndex).toBeGreaterThan(-1)
      expect(tsconfigPathsIndex).toBeGreaterThan(-1)
      expect(guardIndex).toBeLessThan(tsconfigPathsIndex)
    },
    TIMEOUT,
  )
})

describe('$api imports in the ssr environment', () => {
  it(
    'resolves $api imports',
    async () => {
      // This is what `cedar dev` relies on when it runs a route hook's meta()
      // function through ssrLoadModule()
      const resolved = await resolveInEnvironment('ssr', 'resolve')

      expect(resolved).toBe(dbPath)
    },
    TIMEOUT,
  )

  it(
    'resolves $api imports with the guard plugin in place',
    async () => {
      const resolved = await resolveInEnvironment('ssr', 'cedar')

      expect(resolved).toBe(dbPath)
    },
    TIMEOUT,
  )

  it(
    'resolves $api imports of directory named modules',
    async () => {
      // vite-tsconfig-paths resolves most $api imports on its own, through the
      // web side's `$api/*` -> `../api/*` mapping, which is why it looks like
      // cedarjsResolveCedarStyleImportsPlugin's $api handling is redundant.
      // It isn't: plain path mapping doesn't know about Cedar's directory
      // named modules, so `$api/src/services/posts` (posts/posts.ts) only
      // resolves because of the Cedar plugin
      const resolved = await resolveInEnvironment(
        'ssr',
        'cedar',
        '$api/src/services/posts',
      )

      expect(resolved).toBe(servicePath)
    },
    TIMEOUT,
  )
})
