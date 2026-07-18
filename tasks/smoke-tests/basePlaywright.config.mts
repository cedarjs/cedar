import * as fs from 'node:fs'

import type { PlaywrightTestConfig } from '@playwright/test'
import { devices } from '@playwright/test'

/**
 * Extra `cedar dev` args to dodge V8's Maglev JIT crash on Windows
 * (STATUS_STACK_BUFFER_OVERRUN, exit code 3221226505), which otherwise takes
 * down the dev web server mid-run and fails these smoke tests with
 * `net::ERR_CONNECTION_REFUSED`. See
 * https://github.com/nodejs/node/issues/62260 and
 * docs/implementation-plans/flaky-smoke-tests-investigation.md.
 *
 * `--no-maglev` is a V8 flag, so it has to be passed as an actual node CLI arg
 * (not via `NODE_OPTIONS`); `cedar dev --node-args` forwards it to the node
 * process running the web dev server. Empty on non-Windows platforms.
 */
export const windowsNoMaglevDevArgs =
  process.platform === 'win32' ? ' --node-args="--no-maglev"' : ''

// See https://playwright.dev/docs/test-configuration#global-configuration
export const basePlaywrightConfig: PlaywrightTestConfig = {
  testDir: './tests',

  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,

  // Retry on CI only.
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI.
  workers: process.env.CI ? 1 : undefined,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: fs.existsSync('./tests/setup.ts') ? ['setup'] : undefined,
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  reporter: 'list',
}
