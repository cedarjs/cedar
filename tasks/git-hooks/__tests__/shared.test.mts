import { describe, it, expect, afterEach } from 'vitest'

import { execAsync, getYarnCommand } from '../shared.mts'

describe('execAsync', () => {
  it('resolves with exit code 0 for a successful command', async () => {
    const code = await execAsync('node', ['-e', 'process.exit(0)'])
    expect(code).toBe(0)
  })

  it('resolves with the exit code for a failing command', async () => {
    const code = await execAsync('node', ['-e', 'process.exit(42)'])
    expect(code).toBe(42)
  })

  it('rejects when the command is not found', async () => {
    await expect(
      execAsync('this-command-does-not-exist-hopefully', []),
    ).rejects.toThrow()
  })
})

describe('getYarnCommand', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    delete process.env.npm_execpath
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('returns default yarn command when npm_execpath is not set', () => {
    delete process.env.npm_execpath
    const result = getYarnCommand()
    expect(result.command).toBe('yarn')
    expect(result.args).toEqual([])
  })

  it.skip('uses npm_execpath as-is for .cmd files', () => {
    process.env.npm_execpath = '/some/path/yarn.cmd'
    const result = getYarnCommand()
    expect(result.command).toBe('/some/path/yarn.cmd')
    expect(result.args).toEqual([])
  })

  it.skip('uses node to run .js / .mjs / .cjs yarnPath', () => {
    process.env.npm_execpath = '/some/path/yarn.js'
    const result = getYarnCommand()
    expect(result.command).toBe(process.execPath)
    expect(result.args).toEqual(['/some/path/yarn.js'])
  })

  it.skip('for .mjs extension', () => {
    process.env.npm_execpath = '/some/path/yarn.mjs'
    const result = getYarnCommand()
    expect(result.command).toBe(process.execPath)
    expect(result.args).toEqual(['/some/path/yarn.mjs'])
  })

  it.skip('for .cjs extension', () => {
    process.env.npm_execpath = '/some/path/yarn.cjs'
    const result = getYarnCommand()
    expect(result.command).toBe(process.execPath)
    expect(result.args).toEqual(['/some/path/yarn.cjs'])
  })

  it.skip('returns npm_execpath directly for unknown extensions', () => {
    process.env.npm_execpath = '/some/path/yarn'
    const result = getYarnCommand()
    expect(result.command).toBe('/some/path/yarn')
    expect(result.args).toEqual([])
  })
})
