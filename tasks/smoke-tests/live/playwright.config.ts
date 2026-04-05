import { defineConfig } from '@playwright/test'

import { basePlaywrightConfig } from '../basePlaywright.config'

export default defineConfig({
  ...basePlaywrightConfig,

  globalSetup: './globalSetup.mts',

  timeout: 60_000,

  use: {
    baseURL: 'http://localhost:8910',
  },

  webServer: {
    command: 'yarn cedar dev --no-generate --fwd="--no-open"',
    cwd: process.env.CEDAR_TEST_PROJECT_PATH,
    url: 'http://localhost:8911/graphql?query={redwood{version}}',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    env: {
      DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    },
  },
})
