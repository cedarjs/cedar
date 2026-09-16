import { vi, describe, it, expect, beforeEach } from 'vitest'

const { getPrismaDatasourceProvider } = vi.hoisted(() => ({
  getPrismaDatasourceProvider: vi.fn(),
}))

vi.mock('@cedarjs/project-config', () => ({
  getPrismaDatasourceProvider,
}))

import {
  checkTestDatabaseIdentity,
  checkTestDatabaseUrlMatchesProvider,
  redactDatabaseUrl,
} from '../checkTestDatabase.js'

describe('redactDatabaseUrl', () => {
  it('masks the password in a connection string', () => {
    expect(redactDatabaseUrl('postgres://user:secret@host:5432/db')).toBe(
      'postgres://user:***@host:5432/db',
    )
  })

  it('leaves URLs without credentials unchanged', () => {
    expect(redactDatabaseUrl('file:./test.db')).toBe('file:./test.db')
  })

  it('masks semicolon-delimited passwords in SQL Server connection strings', () => {
    expect(
      redactDatabaseUrl(
        'sqlserver://host:1433;database=db;user=sa;password=secret;encrypt=true',
      ),
    ).toBe(
      'sqlserver://host:1433;database=db;user=sa;password=***;encrypt=true',
    )
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

describe('checkTestDatabaseIdentity', () => {
  it('does not throw when the sqlite fallback was used, even with no DATABASE_URL', () => {
    expect(() =>
      checkTestDatabaseIdentity('file:./.cedar/test.db', undefined, true),
    ).not.toThrow()
  })

  it('throws when the sqlite fallback resolves to the same file as DATABASE_URL', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'file:./.cedar/test.db',
        'file:./.cedar/test.db',
        true,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('fails closed when there is no DATABASE_URL to compare an explicit TEST_DATABASE_URL against', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host:5432/myapp_test',
        undefined,
        false,
      ),
    ).toThrow(/there's no DATABASE_URL to confirm/)
  })

  it('does not throw when the test and main databases differ', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host:5432/myapp_test',
        'postgres://host:5432/myapp',
        false,
      ),
    ).not.toThrow()
  })

  it('throws when the test URL is byte-identical to DATABASE_URL', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host:5432/myapp_test',
        'postgres://host:5432/myapp_test',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('throws when the test URL resolves to the same host/port/database as DATABASE_URL, even with different credentials', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://tester:pw@host:5432/myapp?schema=public',
        'postgres://admin:secret@host:5432/myapp',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('treats postgres: and postgresql: as the same provider when comparing identity', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgresql://host:5432/myapp',
        'postgres://host:5432/myapp',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('treats an explicit default port as identical to an omitted one', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host:5432/myapp',
        'postgres://host/myapp',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('treats a trailing dot in the hostname as equivalent to none', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host.example.com./myapp',
        'postgres://host.example.com/myapp',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('does not throw when only the port differs', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://host:5433/myapp',
        'postgres://host:5432/myapp',
        false,
      ),
    ).not.toThrow()
  })

  it('does not throw when only the host differs (e.g. a separate Neon branch or Supabase project sharing a database name)', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://user:pw@ep-test-branch.us-east-2.aws.neon.tech/neondb',
        'postgres://user:pw@ep-main-branch.us-east-2.aws.neon.tech/neondb',
        false,
      ),
    ).not.toThrow()
  })

  it('treats `database` and `Initial Catalog` as the same SQL Server identity field', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'sqlserver://host:1433;database=myapp',
        'sqlserver://host:1433;Initial Catalog=myapp',
        false,
      ),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('throws when two sqlite URLs resolve to the same file', () => {
    expect(() =>
      checkTestDatabaseIdentity('file:./db/dev.db', 'file:./db/dev.db', false),
    ).toThrow(/points at the same database as DATABASE_URL/)
  })

  it('does not throw for two different sqlite files', () => {
    expect(() =>
      checkTestDatabaseIdentity('file:./db/test.db', 'file:./db/dev.db', false),
    ).not.toThrow()
  })

  it('redacts credentials in the thrown error message', () => {
    expect(() =>
      checkTestDatabaseIdentity(
        'postgres://user:secret@host:5432/myapp',
        'postgres://user:secret@host:5432/myapp',
        false,
      ),
    ).toThrow(/user:\*\*\*@host/)
  })
})
