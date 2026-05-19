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
      // With web/ as Vite root, esbuild's dep scan picks up web/index.html and
      // follows imports into web/src/ Cell files, which have no default export
      // (Cedar's Cell plugin isn't run during esbuild dep scan). This breaks
      // pre-bundling of storybook-framework-cedarjs, causing require() in
      // MockProviders.js to fail at runtime and leaving routes unpopulated.
      // Setting root to web/src avoids scanning web/index.html and keeps dep
      // optimization working exactly as it did before the index.html move.
      root: cedarProjectPaths.web.src,
      plugins: [mockRouter(), mockAuth(), autoImports],
      resolve: {
        alias: {
          '~__REDWOOD__USER_ROUTES_FOR_MOCK': cedarProjectPaths.web.routes,
          '~__REDWOOD__USER_WEB_SRC': cedarProjectPaths.web.src,
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
        exclude: ['@storybook/addon-docs'],
      },
    },
  )
}
