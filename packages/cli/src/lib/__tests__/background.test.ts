const { spawnMock, childUnrefMock } = vi.hoisted(() => {
  const childUnrefMock = vi.fn()
  return {
    childUnrefMock,
    spawnMock: vi.fn(() => ({ unref: childUnrefMock })),
  }
})

vi.mock('child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 1),
    writeSync: vi.fn(),
    closeSync: vi.fn(),
  },
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    generated: {
      base: '.cedar',
    },
  }),
}))

import os from 'os'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { spawnBackgroundProcess } from '../background.js'

describe('spawnBackgroundProcess', () => {
  beforeEach(() => {
    spawnMock.mockClear()
    childUnrefMock.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Windows', () => {
    beforeEach(() => {
      vi.spyOn(os, 'type').mockReturnValue('Windows_NT')
    })

    it('quotes args that contain spaces so cmd.exe does not split them', () => {
      spawnBackgroundProcess('telemetry', 'yarn', [
        'node',
        'C:\\Users\\test project\\node_modules\\@cedarjs\\cli\\dist\\telemetry\\send.js',
      ])

      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe(
        'yarn node "C:\\Users\\test project\\node_modules\\@cedarjs\\cli\\dist\\telemetry\\send.js"',
      )
      expect(spawnMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          detached: false,
          windowsHide: false,
          shell: true,
        }),
      )
      expect(childUnrefMock).toHaveBeenCalledTimes(1)
    })

    it('leaves args without whitespace or quotes unquoted', () => {
      spawnBackgroundProcess('updateCheck', 'node', [
        'C:\\cedar\\packages\\cli\\dist\\lib\\updateCheckExecute.js',
      ])

      expect(spawnMock.mock.calls[0][0]).toBe(
        'node C:\\cedar\\packages\\cli\\dist\\lib\\updateCheckExecute.js',
      )
    })

    it('quotes an empty arg as a pair of double quotes', () => {
      spawnBackgroundProcess('telemetry', 'node', ['script.js', ''])

      expect(spawnMock.mock.calls[0][0]).toBe('node script.js ""')
    })

    it('escapes quotes and preceding backslashes per CommandLineToArgvW', () => {
      spawnBackgroundProcess('telemetry', 'node', ['foo\\"bar'])

      expect(spawnMock.mock.calls[0][0]).toBe('node "foo\\\\\\"bar"')
    })

    it('doubles trailing backslashes so they do not escape the closer', () => {
      spawnBackgroundProcess('telemetry', 'node', ['C:\\test project\\'])

      expect(spawnMock.mock.calls[0][0]).toBe('node "C:\\test project\\\\"')
    })
  })

  describe('non-Windows', () => {
    beforeEach(() => {
      vi.spyOn(os, 'type').mockReturnValue('Linux')
    })

    it('passes cmd and args separately without a shell', () => {
      const args = [
        'node',
        '/home/user/test project/node_modules/@cedarjs/cli/dist/telemetry/send.js',
      ]

      spawnBackgroundProcess('telemetry', 'yarn', args)

      expect(spawnMock).toHaveBeenCalledTimes(1)
      expect(spawnMock.mock.calls[0][0]).toBe('yarn')
      expect(spawnMock.mock.calls[0][1]).toEqual(args)
      expect(spawnMock.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          detached: true,
        }),
      )
      expect(spawnMock.mock.calls[0][2]).not.toHaveProperty('shell')
      expect(childUnrefMock).toHaveBeenCalledTimes(1)
    })
  })
})
