import execa from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConfig, getPaths, getPrismaDatasourceProvider } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getPaths: vi.fn(),
  getPrismaDatasourceProvider: vi.fn(),
}))

vi.mock('dotenv-defaults/config.js', () => ({}))

vi.mock('execa', () => ({
  default: Object.assign(vi.fn(), {
    sync: vi.fn(() => ({ exitCode: 0 })),
  }),
}))

vi.mock('@cedarjs/project-config', () => ({
  getConfig,
  getPaths,
  getPrismaDatasourceProvider,
}))

vi.mock('@cedarjs/project-config/packageManager', () => ({
  getPackageManager: () => 'yarn',
}))

const DEFAULT_TEST_CONFIG = {
  autoConsentToDbReset: false,
  acceptedTestDatabaseNames: [] as string[],
}

async function loadEnvironment() {
  const { default: CedarApiVitestEnvironment } =
    await import('../CedarApiVitestEnv.js')
  return CedarApiVitestEnvironment
}

beforeEach(() => {
  vi.resetModules()
  vi.mocked(execa.sync).mockClear()
  getConfig.mockReset()
  getPaths.mockReset()
  getPrismaDatasourceProvider.mockReset()

  getConfig.mockReturnValue({ test: { ...DEFAULT_TEST_CONFIG } })
  getPaths.mockReturnValue({
    generated: { base: '/app/.cedar' },
    api: { base: '/app/api' },
  })

  delete process.env.SKIP_DB_PUSH
  delete process.env.TEST_DATABASE_URL
  delete process.env.TEST_DATABASE_STRATEGY
  delete process.env.TEST_DATABASE_ACCEPT_TARGET
  delete process.env.CEDAR_APP_DATABASE_URL
  delete process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  delete process.env.DATABASE_URL
})

describe('setup', () => {
  it('skips the database reset entirely when SKIP_DB_PUSH is set', async () => {
    process.env.SKIP_DB_PUSH = '1'
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    expect(execa.sync).not.toHaveBeenCalled()
  })

  it('does not set the Prisma consent env var by default', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('sqlite')
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    expect(execa.sync).toHaveBeenCalledTimes(1)
    const [, , options] = vi.mocked(execa.sync).mock.calls[0]
    expect(
      options?.env?.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION,
    ).toBeUndefined()
  })

  it('refuses to run when the test database is the same as DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgres://host:5432/myapp_test'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    const CedarApiVitestEnvironment = await loadEnvironment()

    await expect(CedarApiVitestEnvironment.setup()).rejects.toThrow(
      /points at the same database as DATABASE_URL/,
    )
    expect(execa.sync).not.toHaveBeenCalled()
  })

  it('trusts CEDAR_APP_DATABASE_URL over the already-overwritten DATABASE_URL (the cedar test path)', async () => {
    // Simulates testHandler.ts having already overwritten this child
    // process's DATABASE_URL to the resolved test URL before spawning
    // vitest, while forwarding the real (different) app URL separately.
    process.env.CEDAR_APP_DATABASE_URL = 'postgres://host:5432/myapp'
    process.env.DATABASE_URL = 'postgres://host:5432/myapp_test'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    expect(execa.sync).toHaveBeenCalledTimes(1)
  })

  it('does not falsely refuse when cedar test forwards an empty CEDAR_APP_DATABASE_URL (no real DATABASE_URL of its own)', async () => {
    // Simulates `cedar test api` when the app never had its own
    // DATABASE_URL set — testHandler.ts still forwards the key, but empty,
    // rather than omitting it (which would make this look like a direct
    // `vitest` invocation and fall back to the already-overwritten
    // DATABASE_URL, wrongly matching the test URL).
    process.env.CEDAR_APP_DATABASE_URL = ''
    process.env.DATABASE_URL = 'postgres://host:5432/myapp_test'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    expect(execa.sync).toHaveBeenCalledTimes(1)
  })

  it('auto-consents once opted in, and the target passed the identity guard', async () => {
    process.env.DATABASE_URL = 'postgres://host:5432/myapp'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    getConfig.mockReturnValue({
      test: { ...DEFAULT_TEST_CONFIG, autoConsentToDbReset: true },
    })
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    const [, , options] = vi.mocked(execa.sync).mock.calls[0]
    expect(options?.env?.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION).toEqual(
      expect.stringContaining('Cedar auto-consent'),
    )
  })

  it('never auto-consents when the target fails the identity guard, even when opted in', async () => {
    process.env.DATABASE_URL = 'postgres://host:5432/myapp'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    getConfig.mockReturnValue({
      test: { ...DEFAULT_TEST_CONFIG, autoConsentToDbReset: true },
    })
    const CedarApiVitestEnvironment = await loadEnvironment()

    await expect(CedarApiVitestEnvironment.setup()).rejects.toThrow()
    expect(execa.sync).not.toHaveBeenCalled()
  })

  it('preserves a human-supplied consent value instead of overwriting it', async () => {
    process.env.DATABASE_URL = 'postgres://host:5432/myapp'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION = 'yes, do it'
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    getConfig.mockReturnValue({
      test: { ...DEFAULT_TEST_CONFIG, autoConsentToDbReset: true },
    })
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    const [, , options] = vi.mocked(execa.sync).mock.calls[0]
    expect(options?.env?.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION).toEqual(
      'yes, do it',
    )
  })

  it('preserves an explicitly empty consent value instead of overwriting it', async () => {
    process.env.DATABASE_URL = 'postgres://host:5432/myapp'
    process.env.TEST_DATABASE_URL = 'postgres://host:5432/myapp_test'
    process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION = ''
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')
    getConfig.mockReturnValue({
      test: { ...DEFAULT_TEST_CONFIG, autoConsentToDbReset: true },
    })
    const CedarApiVitestEnvironment = await loadEnvironment()

    await CedarApiVitestEnvironment.setup()

    const [, , options] = vi.mocked(execa.sync).mock.calls[0]
    expect(options?.env?.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION).toEqual(
      '',
    )
  })
})
