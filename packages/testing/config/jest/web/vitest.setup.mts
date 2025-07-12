import path from 'node:path'

import { defineConfig } from 'vitest/config'

import { getPaths } from '@cedarjs/project-config'

const rwjsPaths = getPaths()
const NODE_MODULES_PATH = path.join(rwjsPaths.base, 'node_modules')

export default defineConfig({
  test: {
    root: rwjsPaths.base,

    // TODO: Allow the user to override this if they want to switch to
    // 'happy-dom' for better performance
    environment: 'jsdom',

    include: [path.join(rwjsPaths.web.src, '**/*.{test,spec}.{js,jsx,ts,tsx}')],

    // TODO: Set this to 'false', and let the user configure this on their own
    // if this is something they want
    // Enables global test APIs like describe, it, expect
    globals: true,

    setupFiles: [path.resolve(__dirname, './vitest.setup.js')],

    coverage: {
      provider: 'v8', // or 'c8' or 'istanbul'
      include: ['**/*.{js,jsx,ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      reportsDirectory: path.join(rwjsPaths.base, 'coverage'),
    },

    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.stories.{js,jsx,ts,tsx}',
      '**/*.mock.{js,jsx,ts,tsx}',
    ],
  },

  // Module resolution
  resolve: {
    alias: {
      // Make sure modules use the same versions
      react: path.join(NODE_MODULES_PATH, 'react'),
      'react-dom': path.join(NODE_MODULES_PATH, 'react-dom'),
      '@apollo/client/react': path.join(
        NODE_MODULES_PATH,
        '@apollo/client/react',
      ),

      // Mock implementations
      '@cedarjs/router': path.join(
        NODE_MODULES_PATH,
        '@cedarjs/testing/dist/web/MockRouter.js',
      ),
      '@cedarjs/web': path.join(NODE_MODULES_PATH, '@cedarjs/web/dist/cjs'),
      '@cedarjs/auth': path.join(
        NODE_MODULES_PATH,
        '@cedarjs/testing/dist/web/mockAuth.js',
      ),
      '@cedarjs/testing': path.join(NODE_MODULES_PATH, '@cedarjs/testing/web'),

      // Special Redwood paths
      '~__REDWOOD__USER_ROUTES_FOR_MOCK': rwjsPaths.web.routes,
      '~__REDWOOD__USER_AUTH_FOR_MOCK': path.join(rwjsPaths.web.src, 'auth'),

      // File mocks for assets
      '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga|css)$':
        '@cedarjs/testing/dist/web/fileMock.js',
    },
  },

  // Define global variables for tests
  define: {
    __RWJS_TESTROOT_DIR: JSON.stringify(path.join(rwjsPaths.web.src)),
    'process.env.RWJS_API_URL': JSON.stringify(''),
    'process.env.RWJS_API_GRAPHQL_URL': JSON.stringify('/'),
    'process.env.REDWOOD_APP_TITLE': JSON.stringify('Redwood App'),
    'process.env.RWJS_SRC_ROOT': JSON.stringify(rwjsPaths.web.src),
    RWJS_ENV: {
      RWJS_API_URL: '',
      RWJS_API_GRAPHQL_URL: '/',
      __REDWOOD__APP_TITLE: 'Redwood App',
    },
    RWJS_DEBUG_ENV: {
      RWJS_SRC_ROOT: rwjsPaths.web.src,
    },
  },
})
