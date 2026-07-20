import { beforeAll, vi } from 'vitest'

// If NO_COLOR is set (e.g. inherited from the parent shell) while FORCE_COLOR
// is also set (see vitest.config.mts), Node prints a warning, which breaks
// assertions in a few tests (i.e. cwd.test.ts). It also disables colors in
// libraries like chalk, which breaks snapshot tests that expect colored
// output. This runs before test files are imported, so both in-process color
// detection and child processes spawned by tests are covered
delete process.env.NO_COLOR

vi.mock('prisma/config', () => {
  return {
    defineConfig: (config: unknown) => config,
    env: (envVar: string) => {
      if (envVar === 'DATABASE_URL') {
        return 'file:./dev.db'
      }

      return ''
    },
  }
})

// Disable telemetry within framework tests
beforeAll(() => {
  process.env.CEDAR_DISABLE_TELEMETRY = '1'
})
