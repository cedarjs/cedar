import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handler } from '../jobsHandler.js'

const mocks = vi.hoisted(() => ({ commandSync: vi.fn() }))

vi.mock('execa', () => ({ default: { commandSync: mocks.commandSync } }))

vi.mock('@cedarjs/cli-helpers/packageManager/display', () => ({
  formatRunBinCommand: (bin: string, args: string[] = []) =>
    ['yarn', bin, ...args].join(' '),
}))

vi.mock('../../lib/index.js', () => ({
  getPaths: () => ({ base: '/cedar-app' }),
}))

beforeEach(() => {
  mocks.commandSync.mockReset()
  vi.stubEnv('NODE_ENV', 'production')
})

const forwarded = () => mocks.commandSync.mock.calls[0][0]

describe('yarn cedar jobs', () => {
  it('forwards the command to cedar-jobs', async () => {
    await handler({ _: ['jobs', 'work'], $0: 'cedar' })

    expect(forwarded()).toEqual('yarn cedar-jobs work')
  })

  it("forwards the command's own arguments", async () => {
    await handler({ _: ['jobs', 'pause', '42'], $0: 'cedar' })

    expect(forwarded()).toEqual('yarn cedar-jobs pause 42')
  })

  it('forwards options', async () => {
    await handler({ _: ['jobs', 'start'], $0: 'cedar', n: 'x', name: 'y' })

    expect(forwarded()).toEqual('yarn cedar-jobs start -n x --name y')
  })

  it('forwards an empty command when none is given', async () => {
    await handler({ _: ['jobs'], $0: 'cedar' })

    expect(forwarded()).toEqual('yarn cedar-jobs ')
  })
})
