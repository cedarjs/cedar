import { createRequire } from 'node:module'
import path from 'node:path'

import type { PresetProperty } from 'storybook/internal/types'
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
  const { plugins = [] } = config

  // Needs to run before the react plugin, so add to the front
  plugins.unshift(reactDocgen())
  plugins.unshift(nodePolyfills())

  return mergeConfig(config, {
    // This is necessary as it otherwise just points to the `web` directory,
    // but it needs to point to `web/src`
    root: cedarProjectPaths.web.src,
    plugins: [mockRouter(), mockAuth(), autoImports],
    resolve: {
      alias: {
        '~__REDWOOD__USER_ROUTES_FOR_MOCK': cedarProjectPaths.web.routes,
        '~__REDWOOD__USER_WEB_SRC': cedarProjectPaths.web.src,
      },
    },
    server: {
      // CI was flaky. Sometimes the Storybook tests would pass, sometimes they
      // wouldn't.
      // If the dev server starts serving requests before optimization
      // completes, it causes intermittent ESM/CJS loading errors, which locally
      // shows up as an infinite loading spinner in the web browser, and an
      // error in the browser console about missing exports.
      // Disabling pre-transform ensures the server waits for optimization to
      // complete before processing requests.
      preTransformRequests: false,
    },
  })
}
