import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    logHeapUsage: true,
    setupFiles: ['./vitest.setup.mts'],
    // Still serial, but no longer because of ports - those are reserved per
    // test now (see reservePort in vitest.setup.mts). The remaining reason is
    // the shared fixture directory: the HMR test edits
    // __fixtures__/cedar-ud-app/api/src/functions/hello.ts and restores it
    // afterwards, and udServe's beforeAll builds the same fixture. Isolate the
    // fixture per suite and this can go.
    pool: 'threads',
    fileParallelism: false,
  },
})
