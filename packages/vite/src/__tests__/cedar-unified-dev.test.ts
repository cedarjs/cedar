import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOpen = vi.fn()
const mockWaitForDebugger = vi.fn()

vi.mock('node:inspector', () => ({
  default: { open: mockOpen, waitForDebugger: mockWaitForDebugger },
  open: mockOpen,
  waitForDebugger: mockWaitForDebugger,
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    web: { viteConfig: '/fake/vite.config.ts' },
  }),
  getConfig: () => ({}),
}))

// Suppress the module-level startUnifiedDevServer() auto-execution side effects
vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
vi.spyOn(console, 'error').mockImplementation(() => {})

const { parseCliArgs, openDebugger } = await import('../cedar-unified-dev.js')

describe('parseCliArgs', () => {
  it('extracts debugPort from --debug-port flag', () => {
    const result = parseCliArgs([
      'node',
      'cedar-unified-dev',
      '--debug-port',
      '18911',
    ])

    expect(result.debugPort).toBe(18911)
  })

  it('returns undefined debugPort when --debug-port is absent', () => {
    const result = parseCliArgs(['node', 'cedar-unified-dev', '--port', '8910'])

    expect(result.debugPort).toBeUndefined()
  })

  it('parses --debug-port alongside other flags', () => {
    const result = parseCliArgs([
      'node',
      'cedar-unified-dev',
      '--port',
      '8911',
      '--apiPort',
      '8912',
      '--debug-port',
      '18912',
      '--https',
    ])

    expect(result.debugPort).toBe(18912)
    expect(result.portArg).toBe(8911)
  })

  it('defaults to process.argv when no argv is provided', () => {
    const originalArgv = process.argv
    process.argv = ['node', 'cedar-unified-dev', '--debug-port', '9229']

    const result = parseCliArgs()

    expect(result.debugPort).toBe(9229)
    process.argv = originalArgv
  })

  it('returns undefined debugPort when --debug-port has no value', () => {
    const result = parseCliArgs(['node', 'cedar-unified-dev', '--debug-port'])

    expect(result.debugPort).toBeUndefined()
  })

  it('extracts debugBrk from --debug-brk flag', () => {
    const result = parseCliArgs(['node', 'cedar-unified-dev', '--debug-brk'])

    expect(result.debugBrk).toBe(true)
  })

  it('returns undefined debugBrk when --debug-brk is absent', () => {
    const result = parseCliArgs(['node', 'cedar-unified-dev', '--port', '8910'])

    expect(result.debugBrk).toBeUndefined()
  })
})

describe('openDebugger', () => {
  beforeEach(() => {
    mockOpen.mockClear()
    mockWaitForDebugger.mockClear()
  })

  it('opens the inspector on the given port and 127.0.0.1', async () => {
    await openDebugger(18911)

    expect(mockOpen).toHaveBeenCalledExactlyOnceWith(18911, '127.0.0.1')
    expect(mockWaitForDebugger).not.toHaveBeenCalled()
  })

  it('calls waitForDebugger when the second argument is true', async () => {
    await openDebugger(18911, true)

    expect(mockOpen).toHaveBeenCalledExactlyOnceWith(18911, '127.0.0.1')
    expect(mockWaitForDebugger).toHaveBeenCalledOnce()
  })

  it('does not call waitForDebugger when the second argument is false', async () => {
    await openDebugger(18911, false)

    expect(mockOpen).toHaveBeenCalledExactlyOnceWith(18911, '127.0.0.1')
    expect(mockWaitForDebugger).not.toHaveBeenCalled()
  })
})
