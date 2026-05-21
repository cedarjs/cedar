import { createRequire } from 'node:module'
import path from 'node:path'

import type { PresetProperty } from '@storybook/types'
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
        include: ['rehackt'],
      },
    },
  )
}
