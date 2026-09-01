import { defineConfig } from '@playwright/test'

import {
  basePlaywrightConfig,
  windowsNoMaglevDevArgs,
} from '../basePlaywright.config.mts'

// See https://playwright.dev/docs/test-configuration#global-configuration
export default defineConfig({
  ...basePlaywrightConfig,

  timeout: 30_000 * 2,

  // Starts the mock OIDC server and the tiny cross-site mock provider (see
  // `crossSiteMockProvider.ts`) before any test runs, on the fixed ports the
  // test project's `.env` was patched with by
  // `tasks/test-project/oauth-tasks.mts`.
  globalSetup: './global-setup.ts',

  use: {
    // `localhost`, not `127.0.0.1` (unlike the other suites) -- the
    // cross-site scenario needs the app itself on a hostname distinct from
    // its mock provider (`127.0.0.1`), and every dbAuth cookie in this
    // suite is host-only (no `Domain` attribute), so the host used here has
    // to match the one the OAuth handler's redirect URIs are built against.
    baseURL: 'http://localhost:8910',
  },

  // Run your local dev server before starting the tests
  webServer: {
    command: `yarn cedar dev --no-generate --fwd="--no-open"${windowsNoMaglevDevArgs}`,
    cwd: process.env.CEDAR_TEST_PROJECT_PATH,
    // We wait for the api server to be ready instead of the web server
    // because web starts much faster with Vite.
    url: 'http://127.0.0.1:8911/graphql?query={redwood{version}}',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
})
