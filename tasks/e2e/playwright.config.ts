import { defineConfig, devices } from '@playwright/test'

// The tutorial test runs against a freshly created JavaScript app whose dev
// server is already running (see `tasks/run-e2e.cjs` and
// `.github/workflows/consolidated-tests.yml`). Set CEDAR_TEST_PROJECT_PATH to
// that app's directory.
//
// See https://playwright.dev/docs/test-configuration
export default defineConfig({
  testDir: './tests',

  // The spec files run in file name order, one at a time, because each step
  // builds on the app state the previous one left behind
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,

  // A retry restarts a serial suite from its first step, which repeats every
  // generator and migration. The tests wait for the dev server to pick up each
  // change instead.
  retries: 0,

  // Steps run generators and Prisma migrations, which take a while
  timeout: 5 * 60_000,

  expect: {
    timeout: 15_000,
  },

  use: {
    baseURL: 'http://localhost:8910',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  reporter: 'list',
})
