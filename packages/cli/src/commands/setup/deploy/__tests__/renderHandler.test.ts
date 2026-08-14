import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockWriteFilesTask = vi.fn(() => undefined)

vi.mock('../../../../lib/index.js', async (importOriginal) => {
  const originalLib = await importOriginal<object>()

  return {
    ...originalLib,
    getPaths: () => ({ base: '/mock/project/my-cedar-app' }),
    writeFilesTask: mockWriteFilesTask,
    printSetupNotes: () => ({ title: 'notes', task: () => {} }),
  }
})

vi.mock('@cedarjs/project-config', async (importOriginal) => {
  const originalProjectConfig = await importOriginal<object>()

  return {
    ...originalProjectConfig,
    getPaths: () => ({ base: '/mock/project/my-cedar-app' }),
    getPrismaSchemas: async () => ({ schemas: [] }),
  }
})

vi.mock('../helpers/index.js', async (importOriginal) => {
  const originalHelpers = await importOriginal<object>()

  return {
    ...originalHelpers,
    getUserApiUrl: () => '/.api/functions',
  }
})

const mockGetConfig = vi.fn()
vi.mock('@prisma/internals', () => ({
  default: { getConfig: (...args: unknown[]) => mockGetConfig(...args) },
}))

vi.mock('@cedarjs/telemetry', () => ({
  errorTelemetry: vi.fn(),
}))

const mockPrompts = vi.fn()
vi.mock('prompts', () => ({
  default: (...args: unknown[]) => mockPrompts(...args),
}))

const { handler } = await import('../providers/renderHandler.js')

describe('render setup handler', () => {
  const processExitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never)

  beforeEach(() => {
    mockWriteFilesTask.mockClear()
    mockGetConfig.mockClear()
    mockPrompts.mockClear()
    processExitSpy.mockClear()
    // Matches whatever `database` the handler asks for, so
    // getRenderYamlContent's detected/requested provider check passes.
    mockGetConfig.mockImplementation(async () => ({
      datasources: [{ activeProvider: 'sqlite' }],
    }))
  })

  it('does not write render.yaml when the sqlite paid-plan prompt is declined', async () => {
    mockPrompts.mockResolvedValue({ confirmed: false })

    await handler({ force: false, database: 'sqlite' })

    expect(mockPrompts).toHaveBeenCalledTimes(1)
    expect(mockWriteFilesTask).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  it('writes render.yaml with the paid plan when the sqlite prompt is confirmed', async () => {
    mockPrompts.mockResolvedValue({ confirmed: true })

    await handler({ force: false, database: 'sqlite' })

    expect(mockPrompts).toHaveBeenCalledTimes(1)
    expect(mockWriteFilesTask).toHaveBeenCalledTimes(1)
    const files = mockWriteFilesTask.mock.calls[0][0] as Record<string, string>
    const content = Object.values(files)[0]
    expect(content).toContain('plan: starter')
    expect(content).not.toContain('plan: free')
  })

  it('does not prompt for postgresql, and keeps the free plan', async () => {
    mockGetConfig.mockResolvedValue({
      datasources: [{ activeProvider: 'postgresql' }],
    })

    await handler({ force: false, database: 'postgresql' })

    expect(mockPrompts).not.toHaveBeenCalled()
    expect(mockWriteFilesTask).toHaveBeenCalledTimes(1)
    const files = mockWriteFilesTask.mock.calls[0][0] as Record<string, string>
    const content = Object.values(files)[0]
    expect(content).toContain('plan: free')
  })

  it('does not prompt for none, and keeps the free plan', async () => {
    await handler({ force: false, database: 'none' })

    expect(mockPrompts).not.toHaveBeenCalled()
    expect(mockWriteFilesTask).toHaveBeenCalledTimes(1)
    const files = mockWriteFilesTask.mock.calls[0][0] as Record<string, string>
    const content = Object.values(files)[0]
    expect(content).toContain('plan: free')
  })
})
