import { defineConfig } from '@playwright/test'

import { basePlaywrightConfig } from '../basePlaywright.config.mts'

export default defineConfig({
  ...basePlaywrightConfig,

  timeout: 60_000,

  use: {
    baseURL: 'http://127.0.0.1:8910',
  },

  webServer: {
    command: `node ${import.meta.dirname}/setup.mts && yarn cedar dev --fwd="--no-open"`,
    cwd: process.env.CEDAR_TEST_PROJECT_PATH,
    url: 'http://127.0.0.1:8911/graphql?query={cedar{version}}',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
})
