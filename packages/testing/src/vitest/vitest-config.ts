import dns from 'node:dns'
import path from 'node:path'

import { defineConfig } from 'vitest/config'

import { getPaths } from '@cedarjs/project-config'

import { mockProvidersRelativeRoutesPathsPlugin } from './mockProvidersRelativeRoutesPathsPlugin.js'
import { mockProvidersRoutesPlugin } from './mockProvidersRoutesPlugin.js'

const rwjsPaths = getPaths()
const NODE_MODULES_PATH = path.join(rwjsPaths.base, 'node_modules')

// So that Vite will load on localhost instead of `127.0.0.1`.
// See: https://vitejs.dev/config/server-options.html#server-host.
dns.setDefaultResultOrder('verbatim')

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === 'test' && mockProvidersRoutesPlugin(),
    mode === 'test' && mockProvidersRelativeRoutesPathsPlugin(),
  ],
  ssr: {
    noExternal: ['@cedarjs/testing'],
  },
  test: {
    environment: 'jsdom',
    // TODO: Set this to 'false', and let the user configure this on their own
    // if this is something they want
    // Enables global test APIs like describe, it, expect
    globals: true,
    // setupFiles: ['./vitest.setup.mjs'],
    include: [path.join(rwjsPaths.web.src, '**/*.{test,spec}.{js,jsx,ts,tsx}')],
  },

  resolve:
    mode === 'test'
      ? {
          alias: [
            // Do I need these?
            // react: path.join(NODE_MODULES_PATH, 'react'),
            // 'react-dom': path.join(NODE_MODULES_PATH, 'react-dom'),

            // Mock implementations
            {
              find: /^@cedarjs\/router$/,
              replacement: path.join(
                NODE_MODULES_PATH,
                '@cedarjs/testing/web/MockRouter.js',
              ),
            },
            // {
            //   find: '@cedarjs/web',
            //   replacement: path.join(
            //     NODE_MODULES_PATH,
            //     '@cedarjs/web/dist/cjs'
            //   ),
            // },
            {
              find: /^@cedarjs\/auth$/,
              replacement: path.join(
                NODE_MODULES_PATH,
                '@cedarjs/testing/dist/web/mockAuth.js',
              ),
            },
            // // '@cedarjs/testing': path.join(
            // '~__REDWOOD__USER_ROUTES_FOR_MOCK': {
            //   find: '',
            //   replacement: '',
            // },
            // // '@cedarjs/testing': path.join(
            // //   NODE_MODULES_PATH,
            // //   '@cedarjs/testing/web'
            // // ),
            // '~__REDWOOD__USER_ROUTES_FOR_MOCK': path.join(
            //   __dirname,
            //   'src',
            //   'Routes.tsx'
            // ),
          ],
        }
      : {},
}))
