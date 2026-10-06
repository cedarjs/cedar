import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockWriteFilesTask = vi.fn(
  (_files: Record<string, string>, _options?: unknown) => undefined,
)

// Toggled per test to simulate a project with background jobs set up
let jobsConfigPath: string | null = null

vi.mock('../../../../lib/index.js', async (importOriginal) => {
  const originalLib = await importOriginal<object>()

  return {
    ...originalLib,
    getPaths: () => ({
      base: '/mock/project/My Cedar_App',
      web: { src: '/mock/project/My Cedar_App/web/src' },
      api: { jobsConfig: jobsConfigPath },
    }),
    writeFilesTask: mockWriteFilesTask,
    printSetupNotes: () => ({ title: 'notes', task: () => {} }),
    addPackagesTask: async () => ({ title: 'packages', task: () => {} }),
  }
})

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: vi.fn(() => 'yarn'),
  resetPackageManagerCache: vi.fn(),
}))

vi.mock('@cedarjs/telemetry', () => ({
  errorTelemetry: vi.fn(),
}))

vi.mock('@cedarjs/cli-helpers/telemetry', () => ({
  recordTelemetryAttributes: vi.fn(),
}))

const mockPrompts = vi.fn()
vi.mock('prompts', () => ({
  default: (...args: unknown[]) => mockPrompts(...args),
}))

const { handler, appNameFromPath, setupFiles } =
  await import('../providers/baremetalHandler.js')

/** The files the last run wrote, keyed by path relative to the project */
const writtenFiles = () => {
  const call = mockWriteFilesTask.mock.calls.at(-1)

  if (!call) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(call[0]).map(([filePath, content]) => [
      filePath.replace('/mock/project/My Cedar_App/', ''),
      content,
    ]),
  )
}

describe('appNameFromPath', () => {
  it('turns the project directory name into a unit-safe name', () => {
    expect(appNameFromPath('/srv/My Cedar_App')).toEqual('my-cedar-app')
    expect(appNameFromPath('/srv/effibo')).toEqual('effibo')
    expect(appNameFromPath('/srv/--')).toEqual('cedar')
  })
})

describe('setupFiles', () => {
  const base = {
    appName: 'myapp',
    basePath: '/app',
    webSrcPath: '/app/web/src',
  }

  it('gives pm2 an ecosystem file with a serve app', () => {
    const { files, processNames } = setupFiles({
      ...base,
      monitor: 'pm2',
      jobs: false,
    })

    expect(processNames).toEqual(['serve'])
    expect(files.map((file) => file.path)).toEqual([
      '/app/deploy.toml',
      '/app/ecosystem.config.js',
      '/app/web/src/maintenance.html',
    ])
    expect(files[0].content).toContain('monitor = "pm2"')
    expect(files[0].content).toContain('processNames = ["serve"]')
    expect(files[0].content).not.toContain('monitorCommand =')
    expect(files[1].content).not.toContain('cedar-jobs-worker')
  })

  it('adds a jobs worker app to the ecosystem file when jobs are set up', () => {
    const { files, processNames } = setupFiles({
      ...base,
      monitor: 'pm2',
      jobs: true,
    })

    expect(processNames).toEqual(['serve', 'jobs'])
    expect(files[0].content).toContain('processNames = ["serve", "jobs"]')
    expect(files[1].content).toContain("name: 'jobs'")
    expect(files[1].content).toContain(
      "script: 'api/node_modules/.bin/cedar-jobs-worker'",
    )
    expect(files[1].content).toContain("args: '--index=0 --id=0'")
  })

  it('gives systemd user units named after the app', () => {
    const { files, processNames } = setupFiles({
      ...base,
      monitor: 'systemd-user',
      jobs: false,
    })

    expect(processNames).toEqual(['myapp'])
    expect(files.map((file) => file.path)).toEqual([
      '/app/deploy.toml',
      '/app/systemd/myapp.service',
      '/app/web/src/maintenance.html',
    ])
    expect(files[0].content).toContain('monitor = "systemd-user"')
    expect(files[0].content).toContain('processNames = ["myapp"]')

    const unit = files[1].content
    expect(unit).toContain('WorkingDirectory=/var/www/app/current')
    expect(unit).toContain(
      "ExecStart=/bin/bash -lc 'exec node_modules/.bin/cedar serve'",
    )
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('cp systemd/*.service ~/.config/systemd/user/')
    expect(unit).toContain('loginctl enable-linger')
    expect(unit).not.toContain('User=')
  })

  it('gives systemd system units a User and multi-user target', () => {
    const { files } = setupFiles({
      ...base,
      monitor: 'systemd-system',
      jobs: false,
    })

    const unit = files[1].content
    expect(unit).toContain('WantedBy=multi-user.target')
    expect(unit).toContain('User=deploy')
    expect(unit).toContain('sudo cp systemd/*.service /etc/systemd/system/')
    expect(unit).not.toContain('loginctl')
  })

  it('adds a templated jobs unit and a first instance when jobs are set up', () => {
    const { files, processNames } = setupFiles({
      ...base,
      monitor: 'systemd-user',
      jobs: true,
    })

    expect(processNames).toEqual(['myapp', 'myapp-jobs@0'])
    expect(files.map((file) => file.path)).toEqual([
      '/app/deploy.toml',
      '/app/systemd/myapp.service',
      '/app/systemd/myapp-jobs@.service',
      '/app/web/src/maintenance.html',
    ])
    expect(files[0].content).toContain(
      'processNames = ["myapp", "myapp-jobs@0"]',
    )

    const jobsUnit = files[2].content
    expect(jobsUnit).toContain(
      "ExecStart=/bin/bash -lc 'exec api/node_modules/.bin/cedar-jobs-worker --index=%i --id=0'",
    )
    expect(jobsUnit).toContain('Description=myapp background jobs worker %i')
  })
})

describe('baremetal setup handler', () => {
  // `process.exit`'s real signature returns `never`, so the no-op mock has
  // to lie about its return type to satisfy that signature.
  const processExitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never)

  beforeEach(() => {
    mockWriteFilesTask.mockClear()
    mockPrompts.mockClear()
    processExitSpy.mockClear()
    jobsConfigPath = null
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('writes the pm2 files without asking when --monitor is given', async () => {
    await handler({ force: false, monitor: 'pm2' })

    expect(mockPrompts).not.toHaveBeenCalled()
    expect(Object.keys(writtenFiles())).toEqual([
      'deploy.toml',
      'ecosystem.config.js',
      'web/src/maintenance.html',
    ])
    expect(mockWriteFilesTask).toHaveBeenCalledWith(expect.anything(), {
      overwriteExisting: false,
    })
  })

  it('asks for the monitor when --monitor is not given', async () => {
    mockPrompts.mockResolvedValue({ monitor: 'systemd-user' })

    await handler({ force: true, monitor: undefined })

    expect(mockPrompts).toHaveBeenCalledTimes(1)
    expect(mockPrompts.mock.calls[0][0]).toMatchObject({
      type: 'select',
      name: 'monitor',
    })
    expect(Object.keys(writtenFiles())).toEqual([
      'deploy.toml',
      'systemd/my-cedar-app.service',
      'web/src/maintenance.html',
    ])
    expect(mockWriteFilesTask).toHaveBeenCalledWith(expect.anything(), {
      overwriteExisting: true,
    })
  })

  it('writes nothing when the monitor prompt is cancelled', async () => {
    mockPrompts.mockResolvedValue({})

    await handler({ force: false, monitor: undefined })

    expect(mockWriteFilesTask).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
  })

  it('includes the jobs worker when the project has jobs set up', async () => {
    jobsConfigPath = '/mock/project/My Cedar_App/api/src/lib/jobs.ts'

    await handler({ force: false, monitor: 'systemd-system' })

    const files = writtenFiles()
    expect(Object.keys(files)).toEqual([
      'deploy.toml',
      'systemd/my-cedar-app.service',
      'systemd/my-cedar-app-jobs@.service',
      'web/src/maintenance.html',
    ])
    expect(files['deploy.toml']).toContain(
      'processNames = ["my-cedar-app", "my-cedar-app-jobs@0"]',
    )
  })

  it('rejects an unknown monitor', async () => {
    await handler({ force: false, monitor: 'forever' })

    expect(processExitSpy).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown monitor "forever"'),
    )
  })
})
