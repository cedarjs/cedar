import { beforeEach, describe, expect, it } from 'vitest'

import { TenantScopeError } from '../errors.js'

import { db, rawDb, resetTestDb, tenant } from './helpers/testDb.js'

describe('createTenancyExtension - reads', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('scopes findMany to the current tenant', async () => {
    const projects = await db.project.findMany()
    expect(projects.map((p) => p.id)).toEqual(['p1'])
  })

  it('scopes findFirst to the current tenant', async () => {
    const project = await db.project.findFirst({
      where: { name: 'Project Two' },
    })
    expect(project).toBeNull()
  })

  it('scopes count to the current tenant', async () => {
    await expect(db.project.count()).resolves.toBe(1)
  })

  it('adds the tenant id beside the unique field on findUnique', async () => {
    const own = await db.project.findUnique({ where: { id: 'p1' } })
    expect(own?.id).toBe('p1')

    const other = await db.project.findUnique({ where: { id: 'p2' } })
    expect(other).toBeNull()
  })

  it('findUniqueOrThrow throws Prisma not-found for another tenant row', async () => {
    await expect(
      db.project.findUniqueOrThrow({ where: { id: 'p2' } }),
    ).rejects.toThrow()
  })

  it('throws TenantScopeError when there is no tenant id', async () => {
    tenant.id = undefined
    await expect(db.project.findMany()).rejects.toThrow(TenantScopeError)
    await expect(db.project.findMany()).rejects.toThrow(/Project/)
  })

  it('never restricts a global model', async () => {
    const orgs = await db.organization.findMany()
    expect(orgs.map((o) => o.id).sort()).toEqual(['org1', 'org2'])
  })

  describe('$forOrg', () => {
    it('scopes to the given organization regardless of context', async () => {
      const orgTwoDb = db.$forOrg('org2')
      const projects = await orgTwoDb.project.findMany()
      expect(projects.map((p) => p.id)).toEqual(['p2'])
    })

    it('does not affect the original scoped client', async () => {
      db.$forOrg('org2')
      const projects = await db.project.findMany()
      expect(projects.map((p) => p.id)).toEqual(['p1'])
    })

    it('still blocks raw queries', () => {
      expect(() => db.$forOrg('org2').$queryRaw`SELECT 1`).toThrow(
        TenantScopeError,
      )
    })

    it('returns a client that has $forOrg and $withoutTenant too', async () => {
      const orgTwoDb = db.$forOrg('org2')

      const orgOneProjects = await orgTwoDb.$forOrg('org1').project.findMany()
      expect(orgOneProjects.map((p) => p.id)).toEqual(['p1'])

      const allProjects = await orgTwoDb.$withoutTenant().project.findMany()
      expect(allProjects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    })
  })

  describe('$withoutTenant', () => {
    it('returns every organization’s rows unscoped', async () => {
      const projects = await db.$withoutTenant().project.findMany()
      expect(projects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    })

    it('allows raw queries', async () => {
      const rows = await db.$withoutTenant()
        .$queryRaw`SELECT id FROM Project ORDER BY id`
      expect(rows).toHaveLength(2)
    })

    it('returns a client that has $forOrg and $withoutTenant too', async () => {
      const unscopedDb = db.$withoutTenant()

      const orgTwoProjects = await unscopedDb.$forOrg('org2').project.findMany()
      expect(orgTwoProjects.map((p) => p.id)).toEqual(['p2'])

      const allProjects = await unscopedDb.$withoutTenant().project.findMany()
      expect(allProjects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    })
  })

  describe('raw queries on a scoped client', () => {
    it('blocks $queryRaw', () => {
      expect(() => db.$queryRaw`SELECT 1`).toThrow(TenantScopeError)
    })

    it('blocks $queryRawUnsafe', () => {
      expect(() => db.$queryRawUnsafe('SELECT 1')).toThrow(TenantScopeError)
    })

    it('blocks $executeRaw', () => {
      expect(() => db.$executeRaw`DELETE FROM Project WHERE id = 'p1'`).toThrow(
        TenantScopeError,
      )
    })

    it('blocks $executeRawUnsafe', () => {
      expect(() =>
        db.$executeRawUnsafe("DELETE FROM Project WHERE id = 'p1'"),
      ).toThrow(TenantScopeError)
    })
  })

  describe('$transaction', () => {
    it('stays scoped inside an interactive transaction', async () => {
      const projects = await db.$transaction(async (tx) => {
        return tx.project.findMany()
      })
      expect(projects.map((p) => p.id)).toEqual(['p1'])
    })

    // A client built from a transaction client would run its queries on
    // another connection, outside the transaction
    it.each([
      ['db', () => db],
      ['a $forOrg client', () => db.$forOrg('org2')],
      ['a $withoutTenant client', () => db.$withoutTenant()],
    ])(
      'refuses $forOrg and $withoutTenant on a transaction client of %s',
      async (_name, client) => {
        await expect(
          client().$transaction(async (tx) => {
            // @ts-expect-error -- a transaction client can't call it
            return tx.$forOrg('org2')
          }),
        ).rejects.toThrow(TenantScopeError)
        await expect(
          client().$transaction(async (tx) => {
            // @ts-expect-error -- a transaction client can't call it
            return tx.$withoutTenant()
          }),
        ).rejects.toThrow(/db\.\$forOrg\(organizationId\)\.\$transaction/)
      },
    )
  })

  describe('unsupported operations', () => {
    it('throws TenantScopeError for operations outside the supported set', async () => {
      await expect(db.project.findRaw({})).rejects.toThrow(TenantScopeError)
      await expect(db.project.findRaw({})).rejects.toThrow(/findRaw/)
      await expect(db.project.findRaw({})).rejects.toThrow(/\$withoutTenant/)
    })

    it('points at $withoutTenant() for unsupported operations', async () => {
      await expect(db.project.aggregateRaw({})).rejects.toThrow(
        /\$withoutTenant\(\)/,
      )
    })
  })
})

// A sibling process check: the raw base client (no extension) must still
// see both organizations, proving the extension - not the fixture - is
// what's scoping reads.
describe('framework-owned models', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('never scopes RW_DataMigration, even when allExcept does not list it', async () => {
    const previousTenantId = tenant.id
    tenant.id = undefined

    try {
      await expect(db.rW_DataMigration.findMany()).resolves.toEqual([])
    } finally {
      tenant.id = previousTenantId
    }
  })
})

describe('sanity: unextended client sees everything', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('rawDb.project.findMany() is unscoped', async () => {
    const projects = await rawDb.project.findMany()
    expect(projects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })
})
