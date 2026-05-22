import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import type { PresetProperty } from '@storybook/types'
import type { PluginBuild } from 'esbuild'
import { mergeConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { getPaths } from '@cedarjs/project-config'

import { autoImports } from './plugins/auto-imports.js'
import { mockAuth } from './plugins/mock-auth.js'
import { mockRouter } from './plugins/mock-router.js'
import { reactDocgen } from './plugins/react-docgen.js'
import type { StorybookConfig } from './types.js'

function getAbsolutePath(input: string) {
  const createdRequire = createRequire(import.meta.url)
  return path.dirname(
    createdRequire.resolve(path.join(input, 'package.json'), {
      paths: [getPaths().base],
    }),
  )
}

export const core: PresetProperty<'core'> = {
  builder: getAbsolutePath('@storybook/builder-vite'),
  renderer: getAbsolutePath('@storybook/react'),
}

export const previewAnnotations: StorybookConfig['previewAnnotations'] = (
  entries = [],
) => {
  const createdRequire = createRequire(import.meta.url)
  return [...entries, createdRequire.resolve('./preview.js')]
}

const cedarProjectPaths = getPaths()

export const viteFinal: StorybookConfig['viteFinal'] = async (config) => {
  // Filter out cedar-entry-injection: with web/ as Vite root, Storybook's
  // Vite processes web/index.html whose path matches cedarPaths.web.html,
  // so the plugin would inject Cedar's entry script and break dep scanning.
  const plugins = (config.plugins ?? []).filter(
    (p) =>
      !p ||
      Array.isArray(p) ||
      (p as { name?: string }).name !== 'cedar-entry-injection',
  )

  // Needs to run before the react plugin, so add to the front
  plugins.unshift(await reactDocgen())
  plugins.unshift(nodePolyfills())

  return mergeConfig(
    { ...config, plugins },
    {
      plugins: [mockRouter(), mockAuth(), autoImports],
      resolve: {
        alias: {
          '~__CEDAR__USER_ROUTES_FOR_MOCK': cedarProjectPaths.web.routes,
          '~__CEDAR__USER_WEB_SRC': cedarProjectPaths.web.src,
          // @cedarjs/web imports @apollo/client via explicit .cjs sub-paths
          // (e.g. `@apollo/client/cache/cache.cjs`). In a Node.js / tsc build
          // context these resolve fine, but Vite (ESM-first, browser target)
          // falls back to a ?import CJS interop that can't statically detect
          // named exports, causing runtime SyntaxErrors. Alias the .cjs paths
          // to their package-root equivalents so Vite resolves them through
          // Apollo's package.json `exports` field and picks up the ESM build.
          '@apollo/client/cache/cache.cjs': '@apollo/client/cache',
          '@apollo/client/core/core.cjs': '@apollo/client/core',
          '@apollo/client/link/context/context.cjs':
            '@apollo/client/link/context',
          '@apollo/client/link/core/core.cjs': '@apollo/client/link/core',
          '@apollo/client/link/persisted-queries/persisted-queries.cjs':
            '@apollo/client/link/persisted-queries',
          '@apollo/client/react/hooks/hooks.cjs': '@apollo/client/react/hooks',
          '@apollo/client/react/react.cjs': '@apollo/client/react',
          '@apollo/client/utilities/utilities.cjs': '@apollo/client/utilities',
          // graphql ships CJS-only; alias the explicit sub-path to the package
          // root so Vite resolves it through the exports field (ESM build).
          'graphql/language/printer.js': 'graphql',
        },
      },
      optimizeDeps: {
        // Without this, on first run, Vite throws: `The file does not exist at
        // "{project path}/web/node_modules/.cache/sb-vite/deps/DocsRenderer-NNNQARDV-DEXCJJZJ.js?v=c640a8fa"
        // which is in the optimize deps directory.`
        // This refers to @storybook/addon-docs, which is included as part of @storybook/addon-essentials.
        // the docs addon then includes itself here: https://github.com/storybookjs/storybook/blob/a496ec48c708eed753a5251d55fa07947a869e62/code/addons/docs/src/preset.ts#L198C3-L198C27
        // which I believe gets included by the builder here: https://github.com/storybookjs/storybook/blob/a496ec48c708eed753a5251d55fa07947a869e62/code/builders/builder-vite/src/optimizeDeps.ts#L117
        // TODO: Figure out why this error is being thrown so that this can be removed.
        //
        // Exclude storybook-framework-cedarjs from pre-bundling. Its
        // MockProviders module has a static import of the
        // ~__CEDAR__USER_ROUTES_FOR_MOCK alias, which esbuild would try to
        // resolve during pre-bundling. That leads esbuild into user Cell files
        // which have no default export (Cedar's Cell transform doesn't run
        // during esbuild dep scan), causing pre-bundling to fail entirely.
        // When excluded, Vite serves the package directly through its normal
        // transform pipeline, which does run the Cell plugin correctly.
        exclude: ['@storybook/addon-docs', 'storybook-framework-cedarjs'],
        // Force pre-bundling of CJS-only packages that are only reachable through
        // storybook-framework-cedarjs (excluded above). Without this, Vite serves
        // them via ?import interop, which can't detect named exports in CJS files.
        //
        // Also pre-bundle the Apollo .cjs sub-paths that @cedarjs/web imports.
        // resolve.alias redirects them in the transform pipeline, but esbuild
        // (dep optimizer) ignores resolve.alias. Without this, Vite discovers
        // them on the first page load and triggers a mid-session reload, which
        // tears down the StorybookProvider's GraphQLHooksProvider context and
        // breaks nested-Cell stories. These are structural deps of @cedarjs/web
        // itself, so this list is valid for all Cedar apps, not just the test
        // project.
        include: [
          'rehackt',
          '@apollo/client/cache/cache.cjs',
          '@apollo/client/core/core.cjs',
          '@apollo/client/link/context/context.cjs',
          '@apollo/client/link/core/core.cjs',
          '@apollo/client/link/persisted-queries/persisted-queries.cjs',
          '@apollo/client/react/hooks/hooks.cjs',
          '@apollo/client/react/react.cjs',
          '@apollo/client/utilities/utilities.cjs',
          'graphql/language/printer.js',
          // Pre-bundle node-polyfill shims so Vite doesn't discover them
          // mid-session when storybook-framework-cedarjs (which uses
          // nodePolyfills()) is first rendered. Without this, each shim
          // triggers a separate optimized-deps reload that tears down
          // GraphQLHooksProvider and breaks nested-Cell stories.
          'vite-plugin-node-polyfills/shims/buffer',
          'vite-plugin-node-polyfills/shims/global',
          'vite-plugin-node-polyfills/shims/process',
          // Pre-bundle @cedarjs/testing and graphql-tag so they don't cause
          // mid-session reloads when StorybookProvider loads mock files.
          '@cedarjs/testing/web',
          // Sub-path explicitly imported by @cedarjs/router mock infrastructure
          '@cedarjs/testing/web/MockRouter.js',
          '@cedarjs/testing/auth',
          'graphql-tag',
          // Pre-bundle @cedarjs/web so there is only one instance of
          // GraphQLHooksProvider. Without this, the pre-bundled dep graph and
          // the Vite transform pipeline can each produce their own copy of
          // the module, so RedwoodApolloProvider sets context in one copy
          // while NamedCell reads from the other, causing the
          // "You must register a useQuery hook via the GraphQLHooksProvider"
          // error when a Cell is nested inside another story.
          '@cedarjs/web',
          '@cedarjs/web/apollo',
        ],
        esbuildOptions: {
          plugins: [
            {
              // Cedar's Cell transform (a Vite plugin) injects `export default
              // createCell(...)` at transform time, which doesn't run during
              // esbuild's dep scan. Without a default export, esbuild crashes
              // the scan with "No matching export ... for import 'default'",
              // causing Vite to skip pre-bundling entirely.
              //
              // We must NOT return the real Cell file contents here. If esbuild
              // follows the Cell's imports (e.g. createCell from @cedarjs/web),
              // it pulls GraphQLHooksProvider into its own pre-bundled chunk
              // separately from the @cedarjs/web chunk. That produces two
              // distinct GraphQLHooksContext instances, so the context set by
              // RedwoodApolloProvider is invisible to the Cell's useQuery,
              // causing "You must register a useQuery hook via the
              // GraphQLHooksProvider".
              //
              // Instead we synthesize a stub module: we scan the source for
              // exported names and re-export them as empty stubs, plus add a
              // default export. esbuild treats the Cell as a leaf (no real
              // imports to follow), keeping @cedarjs/web in a single chunk.
              // The real Cell transform runs later via Vite's normal pipeline.
              name: 'cedar-cell-stub',
              setup(build: PluginBuild) {
                build.onLoad({ filter: /Cell\.[jt]sx?$/ }, async (args) => {
                  if (args.path.includes('node_modules')) {
                    return undefined
                  }

                  const src = await fs.promises.readFile(args.path, 'utf-8')

                  // Extract every explicitly exported name so that
                  // `import { Loading, Success } from './MyCell'` resolves
                  // to a stub value rather than undefined.
                  const exportedNames = new Set<string>()
                  // Covers: export const/let/var/function/class Foo
                  for (const m of src.matchAll(
                    /^export\s+(?:const|let|var|function|class)\s+(\w+)/gm,
                  )) {
                    exportedNames.add(m[1])
                  }
                  // Covers: export { Foo, Bar } and export { Foo as Bar }
                  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
                    for (const part of m[1].split(',')) {
                      const name = (part.split(/\bas\b/).pop() ?? '').trim()
                      if (name) {
                        exportedNames.add(name)
                      }
                    }
                  }

                  const namedStubs = [...exportedNames]
                    .filter((n) => n !== 'default')
                    .map((n) => `export const ${n} = undefined`)
                    .join('\n')

                  return {
                    contents: `${namedStubs}\nexport default {}`,
                    loader: 'js',
                  }
                })
              },
            },
          ],
        },
      },
    },
  )
}
