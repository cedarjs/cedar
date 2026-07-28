import path from 'node:path'

import { build, createServer, normalizePath } from 'vite'
import type { PluginOption } from 'vite'
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

let originalCedarCwd: string | undefined

beforeAll(() => {
  // The $api/ resolution needs getPaths() to find a project root
  originalCedarCwd = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = rootDir
})

afterAll(() => {
  if (originalCedarCwd === undefined) {
    delete process.env.CEDAR_CWD
  } else {
    process.env.CEDAR_CWD = originalCedarCwd
  }
})

/**
 * Resolves `$api/src/lib/db` in the given Vite environment, using the given
 * plugins in the order they're passed in
 */
async function resolveInEnvironment(
  environmentName: 'client' | 'ssr',
  plugins: PluginOption[],
) {
  const server = await createServer({
    root: webDir,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins,
  })

  try {
    const environment = server.environments[environmentName]
    const resolved = await environment.pluginContainer.resolveId(
      '$api/src/lib/db',
      importer,
    )

    return resolved?.id ?? null
  } finally {
    await server.close()
  }
}

describe('$api imports in the client environment', () => {
  it('throws when a client module imports $api', async () => {
    await expect(
      resolveInEnvironment('client', [cedarApiImportGuardPlugin()]),
    ).rejects.toThrow(/Cannot import "\$api\/src\/lib\/db" from client-side/)
  })

  it('mentions the importer in the error message', async () => {
    await expect(
      resolveInEnvironment('client', [cedarApiImportGuardPlugin()]),
    ).rejects.toThrow(/dollarApiImport\.ts/)
  })

  it('throws even though tsconfig paths would resolve $api', async () => {
    // The web side's tsconfig.json maps `$api/*` to `../api/*`, so
    // vite-tsconfig-paths resolves $api imports all on its own. The guard
    // plugin has to run before it to be of any use
    await expect(
      resolveInEnvironment('client', [
        cedarApiImportGuardPlugin(),
        tsconfigPaths(),
        cedarjsResolveCedarStyleImportsPlugin(),
      ]),
    ).rejects.toThrow(/Cannot import "\$api\/src\/lib\/db" from client-side/)
  })

  it('fails the client build', async () => {
    await expect(
      build({
        root: webDir,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          cedarApiImportGuardPlugin(),
          tsconfigPaths(),
          cedarjsResolveCedarStyleImportsPlugin(),
        ],
        build: {
          lib: { entry: importer, formats: ['es'] },
          write: false,
          minify: false,
        },
      }),
    ).rejects.toThrow(/Cannot import "\$api\/src\/lib\/db" from client-side/)
  })

  it('does not resolve $api imports without the tsconfig paths mapping', async () => {
    // Without the guard plugin, the import is left unresolved by
    // cedarjsResolveCedarStyleImportsPlugin, and Vite reports its regular
    // "Failed to resolve import" error
    const resolved = await resolveInEnvironment('client', [
      cedarjsResolveCedarStyleImportsPlugin(),
    ])

    expect(resolved).toBe(null)
  })
})

describe('$api imports in the ssr environment', () => {
  it('resolves $api imports', async () => {
    // This is what `cedar dev` relies on when it runs a route hook's meta()
    // function through ssrLoadModule()
    const resolved = await resolveInEnvironment('ssr', [
      cedarjsResolveCedarStyleImportsPlugin(),
    ])

    expect(resolved).toBe(dbPath)
  })

  it('resolves $api imports with the guard plugin in place', async () => {
    const resolved = await resolveInEnvironment('ssr', [
      cedarApiImportGuardPlugin(),
      tsconfigPaths(),
      cedarjsResolveCedarStyleImportsPlugin(),
    ])

    expect(resolved).toBe(dbPath)
  })
})
