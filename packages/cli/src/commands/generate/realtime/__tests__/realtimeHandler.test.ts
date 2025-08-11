import type FS from 'node:fs'

import { vi, describe, afterEach, beforeEach, it, expect } from 'vitest'

// @ts-expect-error - no types for JS files
import { handler } from '../realtimeHandler.js'

const mocks = vi.hoisted(() => ({
  realtimeTs: '',
  serverTs: '',
  writtenFiles: {} as Record<string, string>,
}))

vi.mock('fs-extra', async () => {
  const fs = await vi.importActual<typeof FS>('fs-extra')

  return {
    default: {
      existsSync: (filePath: string) => {
        if (filePath === 'realtime.ts') {
          return !!mocks.realtimeTs
        }

        if (filePath === 'server.ts') {
          return !!mocks.serverTs
        }

        return !filePath.includes('foobar')
      },
      mkdirSync: () => {},
      readFileSync: (filePath: string) => {
        if (filePath.endsWith('blank.ts.template')) {
          return fs.readFileSync(filePath)
        }

        return ''
      },
      writeFileSync: (dst: string, content: string) => {
        // Use `/` on both Windows and Unix
        mocks.writtenFiles[dst.replaceAll(/\\/g, '/')] = content
      },
    },
  }
})

vi.mock('@cedarjs/internal/dist/generate/generate', () => ({
  generate: vi.fn().mockResolvedValue('success'),
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => {
    return {
      base: '',
      api: { src: '', lib: '', graphql: '', services: '', subscriptions: '' },
      web: { base: '', src: '' },
    }
  },
  getConfig: () => ({ experimental: { streamingSsr: { enabled: false } } }),
  resolveFile: (path: string) => path,
}))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(() => void 0 as never)
  mocks.realtimeTs = 'export const realtime: RedwoodRealtimeOptions = {}'
  mocks.serverTs = 'export const serverFile: RedwoodServerFileOptions = {}'
})

afterEach(() => {
  vi.mocked(console).log.mockRestore?.()
  vi.mocked(console).error.mockRestore?.()
  vi.mocked(process).exit.mockRestore?.()
  mocks.writtenFiles = {}
})

describe('realtimeHandler', () => {
  it("Should print error and exit if server-file isn't setup", async () => {
    mocks.serverTs = ''

    await handler({
      name: 'noRealtime',
      type: 'subscription',
      silent: true,
    })

    expect(vi.mocked(console).error).toHaveBeenCalledWith(
      expect.stringMatching(
        'CedarJS Realtime requires a serverful environment. Please run `yarn ' +
          'cedarjs setup server-file` first.',
      ),
    )
    expect(vi.mocked(process).exit).toHaveBeenCalledWith(1)
  })

  it("Should print error and exit if Realtime isn't setup", async () => {
    mocks.realtimeTs = ''

    await handler({
      name: 'noRealtime',
      type: 'subscription',
      silent: true,
    })

    expect(vi.mocked(console).error).toHaveBeenCalledWith(
      expect.stringMatching(
        'Adding realtime events requires that CedarJS Realtime is setup. ' +
          'Please run `yarn cedarjs setup realtime` first.',
      ),
    )
    expect(vi.mocked(process).exit).toHaveBeenCalledWith(1)
  })

  it('should generate a pubSub subscription', async () => {
    await handler({
      name: 'foobar',
      type: 'subscription',
      silent: true,
    })

    expect(mocks.writtenFiles['foobar/foobar.ts']).toMatch(
      "pubSub.subscribe('Foobar', id)",
    )
  })
})
