import path from 'node:path'

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// `createServer.js` (imported by bothCLIConfigHandler.js) resolves `getPaths()`
// as a module-load side effect, so CEDAR_CWD has to point at a real project
// before the dynamic `import('../bothCLIConfigHandler.js')` below runs. The
// fixture's contents don't matter here — apiDistServerFileExists is mocked.
let original_CEDAR_CWD: string | undefined

beforeAll(() => {
  original_CEDAR_CWD = process.env.CEDAR_CWD
  process.env.CEDAR_CWD = path.join(
    import.meta.dirname,
    'fixtures/graphql/cedar-app',
  )
})

afterAll(() => {
  process.env.CEDAR_CWD = original_CEDAR_CWD
})

const { apiDistServerFileExistsMock } = vi.hoisted(() => ({
  apiDistServerFileExistsMock: vi.fn(),
}))

vi.mock('../serverFile.js', () => ({
  apiDistServerFileExists: apiDistServerFileExistsMock,
}))

// The refusal check must fire before anything that touches the network or
// the filesystem, so everything downstream of it is mocked to blow up if
// reached — that's how we know the check actually short-circuits.
vi.mock('../cliHelpers.js', () => ({
  getWebHost: vi.fn(() => {
    throw new Error('should not be reached: refusal check did not fire first')
  }),
  getWebPort: vi.fn(),
  getAPIHost: vi.fn(),
  getAPIPort: vi.fn(),
}))

describe('bothCLIConfigHandler', () => {
  it('refuses to start when a built server file is present', async () => {
    apiDistServerFileExistsMock.mockReturnValue(true)

    const { handler } = await import('../bothCLIConfigHandler.js')

    await expect(handler({})).rejects.toThrow(
      /custom server file is not supported when serving both sides/,
    )
  })

  it('mentions the two-process alternative', async () => {
    apiDistServerFileExistsMock.mockReturnValue(true)

    const { handler } = await import('../bothCLIConfigHandler.js')

    await expect(handler({})).rejects.toThrow(/cedarjs-server api/)
  })

  it('does not refuse when there is no server file', async () => {
    apiDistServerFileExistsMock.mockReturnValue(false)

    const { handler } = await import('../bothCLIConfigHandler.js')

    // Confirms the check isn't just always throwing — it reaches the mocked
    // getWebHost (which itself throws), proving control passed the refusal
    // check and continued into the normal startup path.
    await expect(handler({})).rejects.toThrow(
      'should not be reached: refusal check did not fire first',
    )
  })
})
