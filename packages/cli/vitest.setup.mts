import { beforeAll, vi } from 'vitest'

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
  process.env.REDWOOD_DISABLE_TELEMETRY = 1
})
