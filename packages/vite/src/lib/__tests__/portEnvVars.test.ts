import path from 'node:path'

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest'

let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '__fixtures__',
    'cedar-ud-app',
  )
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// `parseInt` accepts a numeric prefix, so these used to configure the Vite
// proxy as port 8080 and 1 respectively, silently sending API traffic to a
// listener nobody asked for.
describe('getMergedConfig with a malformed CEDAR_API_PORT', () => {
  it.each(['8080abc', '1.5'])('rejects %j', async (value) => {
    vi.stubEnv('CEDAR_API_PORT', value)

    const { getConfig, getPaths } = await import('@cedarjs/project-config')
    const { getMergedConfig } = await import('../getMergedConfig.js')

    expect(() =>
      getMergedConfig(getConfig(), getPaths())(
        {},
        { command: 'serve', mode: 'development' },
      ),
    ).toThrowError(
      `Invalid CEDAR_API_PORT env var value: "${value}". Must be an integer.`,
    )
  })
})
