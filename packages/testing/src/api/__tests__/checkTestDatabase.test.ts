import { vi, describe, it, expect, beforeEach } from 'vitest'

const { getPrismaDatasourceProvider } = vi.hoisted(() => ({
  getPrismaDatasourceProvider: vi.fn(),
}))

vi.mock('@cedarjs/project-config', () => ({
  getPrismaDatasourceProvider,
}))

const { checkTestDatabaseUrlMatchesProvider, redactDatabaseUrl } =
  await import('../checkTestDatabase.js')

describe('redactDatabaseUrl', () => {
  it('masks the password in a connection string', () => {
    expect(redactDatabaseUrl('postgres://user:secret@host:5432/db')).toBe(
      'postgres://user:***@host:5432/db',
    )
  })

  it('leaves URLs without credentials unchanged', () => {
    expect(redactDatabaseUrl('file:./test.db')).toBe('file:./test.db')
  })
})

describe('checkTestDatabaseUrlMatchesProvider', () => {
  beforeEach(() => {
    getPrismaDatasourceProvider.mockReset()
  })

  it('does not throw when the URL scheme matches the provider', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')

    await expect(
      checkTestDatabaseUrlMatchesProvider(
        'postgres://user:pass@host:5432/db',
        false,
      ),
    ).resolves.toBeUndefined()
  })

  it('does not throw for sqlite file: URLs', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('sqlite')

    await expect(
      checkTestDatabaseUrlMatchesProvider('file:./test.db', true),
    ).resolves.toBeUndefined()
  })

  it('throws an actionable error when the URL scheme does not match the provider', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('postgresql')

    await expect(
      checkTestDatabaseUrlMatchesProvider('file:./test.db', true),
    ).rejects.toThrow(/does not match your Prisma schema's provider/)
  })

  it('redacts credentials in the thrown error message', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('mysql')

    await expect(
      checkTestDatabaseUrlMatchesProvider(
        'postgres://user:secret@host:5432/db',
        false,
      ),
    ).rejects.toThrow(/user:\*\*\*@host/)
  })

  it('is a no-op when the provider cannot be determined', async () => {
    getPrismaDatasourceProvider.mockRejectedValue(
      new Error('schema.prisma not found'),
    )

    await expect(
      checkTestDatabaseUrlMatchesProvider('file:./test.db', true),
    ).resolves.toBeUndefined()
  })

  it('is a no-op for unknown/unmapped providers', async () => {
    getPrismaDatasourceProvider.mockResolvedValue('some-future-provider')

    await expect(
      checkTestDatabaseUrlMatchesProvider('file:./test.db', true),
    ).resolves.toBeUndefined()
  })
})
