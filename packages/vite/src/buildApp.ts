import fs from 'node:fs'
import path from 'node:path'

import { catchAllEntry, getAllEntries } from '@universal-deploy/store'
import { catchAll } from '@universal-deploy/vite'
import type { EnvironmentOptions, Plugin, PluginOption } from 'vite'
import { createBuilder, normalizePath } from 'vite'
import { gqlPlugin as gqlTagPlugin } from 'vite-plugin-graphql-tag'
import tsPathsMod from 'vite-tsconfig-paths'

// vite-tsconfig-paths is ESM-only. CJS builds double-wrap its default
// export: tsconfigPaths.default is the module object, and
// tsconfigPaths.default.default is the actual function. ESM gets the
// function directly. The `||` chain resolves correctly for both.
const tsconfigPaths =
  // @ts-expect-error – .default only exists at runtime in CJS double-wrap
  // interop
  tsPathsMod.default?.default || tsPathsMod.default || tsPathsMod

import {
  getApiSideBabelConfigPath,
  getApiSideBabelPluginsForVite,
  transformWithBabel,
} from '@cedarjs/babel-config'
import {
  applyEsmExtensions,
  applySrcAlias,
} from '@cedarjs/internal/dist/build/api.js'
import { findApiFiles } from '@cedarjs/internal/dist/files.js'
import { getConfig, getPaths, projectSideIsEsm } from '@cedarjs/project-config'

import { generateDiffSourceMap } from './lib/generateDiffSourceMap.js'
import { getWorkspacePackageAliases } from './lib/workspacePackageAliases.js'
import { cedarAutoImportsPlugin } from './plugins/vite-plugin-cedar-auto-import.js'
import { cedarDirectoryNamedImportPlugin } from './plugins/vite-plugin-cedar-directory-named-import.js'
import { cedarGqlormInjectPlugin } from './plugins/vite-plugin-cedar-gqlorm-inject.js'
import { cedarGraphqlOptionsExtractPlugin } from './plugins/vite-plugin-cedar-graphql-options-extract.js'
import { cedarImportDirPlugin } from './plugins/vite-plugin-cedar-import-dir.js'
import { cedarMockCellDataPlugin } from './plugins/vite-plugin-cedar-mock-cell-data.js'
import { cedarOtelWrappingPlugin } from './plugins/vite-plugin-cedar-otel-wrapping.js'
import { cedarjsJobPathInjectorPlugin } from './plugins/vite-plugin-cedarjs-job-path-injector.js'
import { handlerAlsWrappingPlugin } from './plugins/vite-plugin-handler-als-wrapping.js'

function resolveWithExtensions(id: string): string {
  // A bare `fs.existsSync(id)` also returns true for directories (e.g. a
  // directory-named-import target). Since this plugin's resolveId return
  // short-circuits Vite's resolveId chain, that would incorrectly claim the
  // bare directory path as fully resolved instead of letting a later plugin
  // (e.g. one resolving directory-named imports) handle it.
  if (fs.existsSync(id) && fs.statSync(id).isFile()) {
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
  ud?: boolean
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
  ud = false,
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
            } else if (!id.startsWith('.') && !path.isAbsolute(id)) {
              return true
            }

            return false
          },
        },
      },
    }

    if (ud) {
      environments['ssr'] = {
        build: {
          ssr: true,
          outDir: path.join(cedarPaths.api.dist, 'ud'),
          emptyOutDir: true,
          rollupOptions: {
            input: catchAllEntry,
            output: {
              entryFileNames: 'index.js',
            },
            external: (id: string) => {
              if (id.startsWith('virtual:')) {
                return false
              } else if (id.startsWith('node:')) {
                return true
              } else if (!id.startsWith('.') && !path.isAbsolute(id)) {
                return true
              }

              return false
            },
          },
        },
      }
    }
  }

  const workspacePkgSourceMap = workspace.includes('api')
    ? Object.fromEntries(
        Object.entries(getWorkspacePackageAliases(cedarPaths, cedarConfig)).map(
          ([name, sourceFile]) => [name, normalizePath(sourceFile)],
        ),
      )
    : {}

  const plugins: PluginOption[] = [
    tsconfigPaths(),
    cedarAutoImportsPlugin(),
    (() => {
      const p = gqlTagPlugin() as Plugin
      p.enforce = 'post'
      return p
    })(),
    // Suppress noisy warnings from third-party dependencies across all
    // environments by injecting onwarn into every environment's rollupOptions.
    {
      name: 'cedar-suppress-third-party-warnings',
      configResolved(config) {
        function onwarn(warning: any, warn: (w: any) => void) {
          // Prisma internals uses `eval()` for path resolution which produces
          // EVAL warnings. The code is safe and works correctly at runtime.
          // Tracked upstream: https://github.com/prisma/prisma/issues/20752
          if (
            warning.code === 'EVAL' &&
            warning.id?.includes('@prisma/internals')
          ) {
            return
          }

          // graphql-scalars places `/*#__PURE__*/` on object literal exports
          // which Rolldown can't interpret (only valid before call/new
          // expressions).
          // Tracked upstream:
          // https://github.com/graphql-hive/graphql-scalars/issues/2869
          if (
            warning.code === 'INVALID_ANNOTATION' &&
            warning.id?.includes('graphql-scalars')
          ) {
            return
          }

          warn(warning)
        }

        for (const env of Object.values(config.environments ?? {})) {
          env.build.rollupOptions ??= {}
          const existingOnwarn = env.build.rollupOptions.onwarn
          env.build.rollupOptions.onwarn = existingOnwarn
            ? (warning, warn) => {
                onwarn(warning, (w) => existingOnwarn(w, warn))
              }
            : onwarn
        }
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
          importer?.includes('node_modules') &&
          this.environment.config.consumer === 'server'
        ) {
          return { id: specifier, external: true }
        }

        return null
      },
    },
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
    },
    {
      name: 'cedar-build-app',
      buildApp: {
        order: 'pre',
        async handler(builder) {
          // Vite 7's default buildApp is a no-op. Vite's built-in fallback only
          // builds environments if NONE have been built yet. When a third-party
          // plugin (e.g. vite-plugin-vercel) adds a `buildApp` hook that builds
          // its own environments, the fallback is skipped because some
          // environments are already marked as built. We must explicitly build
          // Cedar's `client` and `api` environments here to ensure they are
          // produced regardless of what other plugins do.
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

          if (
            workspace.includes('api') &&
            builder.environments['ssr'] &&
            !builder.environments['ssr'].isBuilt
          ) {
            await builder.build(builder.environments['ssr'])
          }
        },
      },
    },
  ]

  if (ud) {
    plugins.push(catchAll())

    plugins.push({
      name: 'cedar-ud-verify-routes',
      configResolved() {
        const entries = getAllEntries()
        if (entries.length === 0) {
          console.warn(
            '\n',
            ' Warning: No Universal Deploy API routes were registered.\n',
            ' The built server entry will be an empty router (404 for all\n',
            ' requests). Check that you have API functions under\n',
            ' `api/src/functions/` and that your vite config includes\n',
            ' `cedarUniversalDeployPlugin()`.\n',
          )
        }
      },
    })

    plugins.push({
      name: 'cedar-ud-write-package-json',
      applyToEnvironment(env) {
        return env.name === 'ssr'
      },
      closeBundle() {
        const dir = path.join(cedarPaths.api.dist, 'ud')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(
          path.join(dir, 'package.json'),
          JSON.stringify({ type: 'module' }, null, 2),
        )
      },
    })
  }

  if (workspace.includes('api')) {
    plugins.push({
      name: 'cedar-api-src-redirect',
      enforce: 'pre',
      resolveId(id: string, importer: string | undefined) {
        // Normalize both sides: on Windows, cedarPaths.api.src can contain
        // backslashes while Vite supplies forward-slash importer ids, so a
        // raw startsWith would never match. The trailing separator guards
        // against matching an adjacent directory (e.g. `api/src-extra`).
        const normalizedImporter = importer && normalizePath(importer)
        const normalizedApiSrc = normalizePath(cedarPaths.api.src)

        if (!normalizedImporter?.startsWith(`${normalizedApiSrc}/`)) {
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
  }

  if (workspace.includes('api')) {
    plugins.push(cedarGraphqlOptionsExtractPlugin())
    plugins.push(cedarGqlormInjectPlugin())
    plugins.push(cedarImportDirPlugin())
    plugins.push(cedarDirectoryNamedImportPlugin())
    plugins.push(cedarOtelWrappingPlugin())
    plugins.push(cedarjsJobPathInjectorPlugin())
    plugins.push(
      handlerAlsWrappingPlugin({ projectIsEsm: projectSideIsEsm('api') }),
    )
  }

  plugins.push(cedarMockCellDataPlugin())

  if (workspace.includes('api')) {
    plugins.push({
      name: 'cedar-vite-api-babel-transform',
      enforce: 'pre',
      async transform(code: string, id: string) {
        if (!/\.(js|ts|tsx|jsx)$/.test(id)) {
          return null
        }

        if (id.includes('node_modules')) {
          return null
        }

        if (!normalizePath(id).startsWith(normalizePath(cedarPaths.api.base))) {
          return null
        }

        // The Babel pass is only needed to apply a user's custom
        // api/babel.config.js: getApiSideBabelPluginsForVite() is empty (all of
        // Cedar's api-side Babel transforms are handled by dedicated Vite
        // plugins in this pipeline) and Vite strips TypeScript itself. Skip
        // Babel entirely when the project has no such config file.
        const babelPlugins = getApiSideBabelConfigPath()
          ? getApiSideBabelPluginsForVite()
          : null

        // babel-plugin-module-resolver is not part of
        // getApiSideBabelPluginsForVite().  That plugin
        // previously rewrote `src/` bare specifiers to relative paths so
        // that Rollup's `external` function (which marks anything that is
        // not relative or absolute as external) would not capture them.
        // Apply the same rewrite here so that `src/lib/logger` → `../../lib/logger`
        // and the external function sees a relative path (starting with `.`).
        const fromDirRelativeToApiSrc = path.relative(
          cedarPaths.api.src,
          path.dirname(id),
        )

        const applyImportRewrites = (source: string) => {
          let rewritten = applySrcAlias(source, fromDirRelativeToApiSrc)

          // For ESM projects, append .js/.jsx extensions to extensionless
          // relative imports so Node's ESM resolver can find them at runtime.
          // This is needed because cedarImportDirPlugin expands glob imports
          // (e.g. `src/directives/**/*.{js,ts}`) into individual extensionless
          // import statements, and Rollup with preserveModules:true preserves
          // those specifiers as-is in the output.
          if (projectSideIsEsm('api')) {
            rewritten = applyEsmExtensions(rewritten, id)
          }

          return rewritten
        }

        const rewrittenCode = applyImportRewrites(code)

        if (!babelPlugins) {
          // Without Babel there's no transform to report when the string
          // rewrites didn't change anything.
          if (rewrittenCode === code) {
            return null
          }

          // The rewrites only replace import specifiers in place, so the
          // diff-derived map gives exact line and column mappings — including
          // the columns after a rewritten specifier on the same line.
          return {
            code: rewrittenCode,
            map: generateDiffSourceMap(code, rewrittenCode),
          }
        }

        // The rewrites run BEFORE Babel so their map can be handed to Babel
        // as inputSourceMap — Babel then emits a map composed all the way
        // back to this hook's input instead of one that stops at the
        // rewritten intermediate.
        const inputSourceMap =
          rewrittenCode === code
            ? null
            : generateDiffSourceMap(code, rewrittenCode)

        // Babel can only compose the input map when its `sources` names the
        // module — magic-string maps default to an empty source name, which
        // makes the merged map's positions resolve to nothing.
        if (inputSourceMap) {
          inputSourceMap.sources = [id]
        }

        const transformedCode = await transformWithBabel(
          rewrittenCode,
          id,
          babelPlugins,
          true,
          true,
          inputSourceMap ?? undefined,
        )

        if (!transformedCode?.code) {
          return null
        }

        // Safety net: a user Babel plugin can itself emit `src/` imports or
        // extensionless relative imports, which Rollup's `external` function
        // would otherwise misclassify. In that rare case the returned map
        // doesn't cover this final edit — matching the previous behavior,
        // where every rewrite ran after Babel.
        return {
          code: applyImportRewrites(transformedCode.code),
          map: transformedCode.map ?? null,
        }
      },
    })
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
