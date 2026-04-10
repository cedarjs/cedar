import { defineConfig } from '@playwright/test'

import { basePlaywrightConfig } from '../basePlaywright.config.mts'

export default defineConfig({
  ...basePlaywrightConfig,

  timeout: 60_000,

  use: {
    baseURL: 'http://localhost:8910',
  },

  webServer: {
    command: `node ${import.meta.dirname}/setup.mts && yarn cedar dev --no-generate --fwd="--no-open"`,
    cwd:
      process.env.CEDAR_TEST_PROJECT_PATH ||
      '/Users/tobbe/dev/cedarjs/cedar-gemini/local-testing-project-live',
    url: 'http://localhost:8911/graphql?query={cedar{version}}',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
})
