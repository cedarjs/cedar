import { beforeAll } from 'vitest'

// Disable telemetry within framework tests
beforeAll(() => {
  process.env.CEDAR_DISABLE_TELEMETRY = '1'
})
