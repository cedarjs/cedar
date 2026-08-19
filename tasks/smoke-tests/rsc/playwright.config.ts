import { defineConfig } from '@playwright/test'

import { basePlaywrightConfig } from '../basePlaywright.config.mts'

// See https://playwright.dev/docs/test-configuration#global-configuration
export default defineConfig({
  ...basePlaywrightConfig,

  use: {
    baseURL: 'http://127.0.0.1:8910',
  },

  // Run your local dev server before starting the tests
  webServer: {
    command: 'yarn cedar serve',
    cwd: process.env.CEDAR_TEST_PROJECT_PATH,
    url: 'http://127.0.0.1:8910',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
})
