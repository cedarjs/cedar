import fs from 'node:fs'
import path from 'node:path'

import type { EnvironmentOptions, PluginOption } from 'vite'
import { createBuilder, normalizePath } from 'vite'

import {
  getApiSideBabelPlugins,
  transformWithBabel,
} from '@cedarjs/babel-config'
import { findApiFiles } from '@cedarjs/internal/dist/files.js'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import { getWorkspacePackageAliases } from './lib/workspacePackageAliases.js'

function resolveWithExtensions(id: string): string {
  if (fs.existsSync(id)) {
    return id
  }
  for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts']) {
    const withExt = id + ext
    if (fs.existsSync(withExt)) {
      return withExt
    }
  }
  return id
}

export interface BuildCedarAppOptions {
  verbose?: boolean
  workspace?: string[]
}

/**
 * Unified build for Cedar apps using Vite's builder API.
 *
 * Declares `client` and `api` environments and builds them in a single
 * orchestrated pass. The web client is built from the project's web Vite
 * config. The API is built as an SSR environment with Babel transforms and
 * `src/` import redirection so it resolves correctly even though the builder
 * root is the web source directory.
 */
export async function buildCedarApp({
  verbose = false,
  workspace = ['api', 'web'],
}: BuildCedarAppOptions = {}) {
  const cedarPaths = getPaths()
  const cedarConfig = getConfig()

  const environments: Record<string, EnvironmentOptions> = {}

  if (workspace.includes('web')) {
    environments.client = {
      build: {
        outDir: cedarPaths.web.dist,
      },
    }
  }

  if (workspace.includes('api')) {
    const isEsm = projectSideIsEsm('api')
    const format = isEsm ? 'es' : 'cjs'
    const apiFiles = findApiFiles()

    const input: Record<string, string> = {}
    for (const f of apiFiles) {
      const key = path
        .relative(cedarPaths.api.src, f)
        .replace(/\.(ts|tsx|mts|js|jsx|mjs)$/, '')
      input[key] = f
    }

    environments.api = {
      build: {
        ssr: true,
        sourcemap: true,
        outDir: cedarPaths.api.dist,
        emptyOutDir: true,
        rollupOptions: {
          input,
          output: {
            format,
            preserveModules: true,
            preserveModulesRoot: cedarPaths.api.src,
            entryFileNames: '[name].js',
            exports: 'named',
          },
          external: (id: string) => {
            if (id.startsWith('node:')) {
              return true
            }
            if (!id.startsWith('.') && !path.isAbsolute(id)) {
              return true
            }
            return false
          },
          onwarn(warning, warn) {
            // UNRESOLVED_IMPORT for bare imports inside node_modules are
            // optional/peer dependencies that are already externalized by
            // the external() function above. Skip the noise — they'll be
            // resolved at runtime (or fail gracefully).
            if (
              warning.code === 'UNRESOLVED_IMPORT' &&
              warning.id?.includes('node_modules')
            ) {
              return
            }
            // EVAL and INVALID_ANNOTATION come from third-party packages
            // (Prisma, graphql-scalars) and are harmless — the code works
            // correctly at runtime despite Rollup's concerns.
            if (
              warning.code === 'EVAL' ||
              warning.code === 'INVALID_ANNOTATION'
            ) {
              return
            }
            warn(warning)
          },
        },
      },
    }
  }

  const babelPlugins = workspace.includes('api')
    ? getApiSideBabelPlugins({
        openTelemetry:
          (cedarConfig.experimental?.opentelemetry?.enabled ?? false) &&
          (cedarConfig.experimental?.opentelemetry?.wrapApi ?? false),
        projectIsEsm: projectSideIsEsm('api'),
      })
    : null

  const workspacePkgSourceMap = workspace.includes('api')
    ? Object.fromEntries(
        Object.entries(getWorkspacePackageAliases(cedarPaths, cedarConfig)).map(
          ([name, sourceFile]) => [name, normalizePath(sourceFile)],
        ),
      )
    : {}

  const plugins: PluginOption[] = [
    {
      name: 'cedar-build-app-cleanup',
      configResolved(config) {
        // Vite always instantiates a default 'client' environment from the
        // config file, even when the caller didn't declare it. Remove it when
        // the workspace filter excludes 'web' so that API-only builds don't
        // accidentally compile the web client.
        if (!workspace.includes('web') && config.environments.client) {
          delete (config.environments as Record<string, unknown>).client
        }

        // Vite adds a default 'ssr' environment alongside 'client'. When we
        // are building the API as a separate environment ('api'), the default
        // 'ssr' environment is redundant and inherits the web HTML input,
        // causing Vite to throw "rollupOptions.input should not be an html file
        // when building for SSR". Remove it unless the caller explicitly
        // declared it.
        if (!environments.ssr && config.environments.ssr) {
          delete (config.environments as Record<string, unknown>).ssr
        }
      },
      buildApp: {
        order: 'pre',
        async handler(builder) {
          // Vite 7's default buildApp is a no-op. The fallback only builds
          // environments if NONE have been built yet. When a third-party
          // plugin (e.g. vite-plugin-vercel) adds a `buildApp` hook that
          // builds its own environments, the fallback is skipped because
          // some environments are already marked as built. We must
          // explicitly build Cedar's `client` and `api` environments here
          // to ensure they are produced regardless of what other plugins do.
          if (
            workspace.includes('web') &&
            builder.environments.client &&
            !builder.environments.client.isBuilt
          ) {
            await builder.build(builder.environments.client)
          }

          if (
            workspace.includes('api') &&
            builder.environments.api &&
            !builder.environments.api.isBuilt
          ) {
            await builder.build(builder.environments.api)
          }
        },
      },
    },
    // Resolve bare-specifier dynamic imports from node_modules as external
    // before Rollup attempts resolution, avoiding UNRESOLVED_IMPORT warnings
    // for optional peer dependencies (e.g. @simplewebauthn/server).
    {
      name: 'cedar-optional-peer-deps',
      resolveDynamicImport(specifier, importer) {
        if (
          typeof specifier === 'string' &&
          !specifier.startsWith('.') &&
          !specifier.startsWith('/') &&
          importer?.includes('node_modules')
        ) {
          return { id: specifier, external: true }
        }
        return null
      },
    },
  ]

  if (workspace.includes('api')) {
    plugins.push({
      name: 'cedar-api-src-redirect',
      enforce: 'pre',
      resolveId(id: string, importer: string | undefined) {
        if (!importer?.startsWith(cedarPaths.api.src)) {
          return null
        }
        if (id.startsWith('src/')) {
          return resolveWithExtensions(
            path.join(cedarPaths.api.src, id.slice(4)),
          )
        }
        return null
      },
    })

    if (babelPlugins) {
      plugins.push({
        name: 'cedar-vite-api-babel-transform',
        async transform(_code: string, id: string) {
          if (!/\.(js|ts|tsx|jsx)$/.test(id)) {
            return null
          }

          if (id.includes('node_modules')) {
            return null
          }

          if (
            !normalizePath(id).startsWith(normalizePath(cedarPaths.api.base))
          ) {
            return null
          }

          const transformedCode = await transformWithBabel(id, babelPlugins)

          if (transformedCode?.code) {
            return {
              code: transformedCode.code,
              map: transformedCode.map ?? null,
            }
          }

          return null
        },
      })
    }
  }

  const builder = await createBuilder({
    configFile: cedarPaths.web.viteConfig,
    envFile: false,
    logLevel: verbose ? 'info' : 'warn',
    environments,
    resolve: {
      alias: workspacePkgSourceMap,
    },
    plugins,
  })

  return builder.buildApp()
}
