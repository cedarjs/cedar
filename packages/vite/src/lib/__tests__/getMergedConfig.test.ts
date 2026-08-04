import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '__fixtures__',
  'cedar-ud-app',
)

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = fixtureDir
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getMergedConfig api proxy target', () => {
  // `server` is dev-only Vite config — `vite build` never reads it — so the
  // proxy target's host must not depend on NODE_ENV. It's always the dev
  // server's own outbound connection to the api server, regardless of what
  // NODE_ENV happens to be set to while `vite dev`/`vite serve` runs.
  it.each(['development', 'production', undefined])(
    'always uses the IPv4 loopback, even when NODE_ENV is %j',
    async (nodeEnv) => {
      if (nodeEnv) {
        vi.stubEnv('NODE_ENV', nodeEnv)
      } else {
        vi.stubEnv('NODE_ENV', '')
        delete process.env.NODE_ENV
      }

      const { getConfig, getPaths } = await import('@cedarjs/project-config')
      const { getMergedConfig } = await import('../getMergedConfig.js')

      const merged = getMergedConfig(getConfig(), getPaths())(
        {},
        { command: 'serve', mode: 'development' },
      )

      const proxy = merged.server?.proxy?.['/.api/functions']
      const target = proxy && 'target' in proxy ? proxy.target : undefined

      // Port comes from the fixture's own cedar.toml (`[api] port = 18911`).
      expect(target).toBe('http://127.0.0.1:18911')
    },
  )
})
