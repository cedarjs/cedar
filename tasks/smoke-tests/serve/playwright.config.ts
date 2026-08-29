import { defineConfig } from '@playwright/test'

import { basePlaywrightConfig } from '../basePlaywright.config.mts'

// See https://playwright.dev/docs/test-configuration#global-configuration
export default defineConfig({
  ...basePlaywrightConfig,

  timeout: 30_000 * 2,

  use: {
    baseURL: 'http://127.0.0.1:8910',
  },

  // Run your local dev server before starting the tests
  webServer: {
    command: process.env.CEDAR_SERVE_UD
      ? 'yarn cedar serve --ud'
      : 'yarn cedar serve',
    cwd: process.env.CEDAR_TEST_PROJECT_PATH,
    url: 'http://127.0.0.1:8910',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    // Explicit (matches Playwright's own default when unset) so it's clear
    // this is intentional: we want the webServer child's stderr forwarded
    // to the test report, not swallowed, to help diagnose #2489-style
    // silent startup failures.
    stderr: 'pipe',
  },
})
