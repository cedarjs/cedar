import { beforeEach, describe, expect, it } from 'vitest'

import { TenantScopeError } from '../errors.js'

import { db, resetTestDb, tenant } from './helpers/testDb.js'

describe('createTenancyExtension - writes', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  describe('create', () => {
    it('injects the tenant field', async () => {
      const project = await db.project.create({
        data: { id: 'p3', name: 'Project Three' },
      })
      expect(project.organizationId).toBe('org1')
    })

    it('accepts a matching explicit tenant field', async () => {
      const project = await db.project.create({
        data: { id: 'p3', name: 'Project Three', organizationId: 'org1' },
      })
      expect(project.organizationId).toBe('org1')
    })

    it('rejects a conflicting explicit tenant field', async () => {
      await expect(
        db.project.create({
          data: { id: 'p3', name: 'Project Three', organizationId: 'org2' },
        }),
      ).rejects.toThrow(TenantScopeError)
    })

    it('throws TenantScopeError with no tenant id', async () => {
      tenant.id = undefined
      await expect(
        db.project.create({ data: { id: 'p3', name: 'Project Three' } }),
      ).rejects.toThrow(TenantScopeError)
    })

    it('scopes a nested create under a tenant-owned relation', async () => {
      const project = await db.project.create({
        data: {
          id: 'p3',
          name: 'Project Three',
          tasks: { create: [{ id: 't1', title: 'Task One' }] },
        },
        include: { tasks: true },
      })
      expect(project.tasks).toHaveLength(1)
      expect(project.tasks[0].organizationId).toBe('org1')
    })
  })

  describe('createMany / createManyAndReturn', () => {
    it('injects the tenant field for a single object', async () => {
      await db.project.createMany({
        data: { id: 'p3', name: 'Project Three' },
      })
      const project = await db.$withoutTenant().project.findUniqueOrThrow({
        where: { id: 'p3' },
      })
      expect(project.organizationId).toBe('org1')
    })

    it('injects the tenant field for every row in an array', async () => {
      await db.project.createMany({
        data: [
          { id: 'p3', name: 'Project Three' },
          { id: 'p4', name: 'Project Four' },
        ],
      })
      const projects = await db
        .$withoutTenant()
        .project.findMany({ where: { id: { in: ['p3', 'p4'] } } })
      expect(projects.every((p) => p.organizationId === 'org1')).toBe(true)
    })

    it('rejects an array with one conflicting row', async () => {
      await expect(
        db.project.createMany({
          data: [
            { id: 'p3', name: 'Project Three' },
            { id: 'p4', name: 'Project Four', organizationId: 'org2' },
          ],
        }),
      ).rejects.toThrow(TenantScopeError)
    })

    it('createManyAndReturn injects the tenant field', async () => {
      const rows = await db.project.createManyAndReturn({
        data: [{ id: 'p3', name: 'Project Three' }],
      })
      expect(rows[0].organizationId).toBe('org1')
    })
  })

  describe('update', () => {
    it('scopes the where clause beside the unique field', async () => {
      const updated = await db.project.update({
        where: { id: 'p1' },
        data: { name: 'Renamed' },
      })
      expect(updated.name).toBe('Renamed')
    })

    it('fails for a row in another organization', async () => {
      await expect(
        db.project.update({
          where: { id: 'p2' },
          data: { name: 'Renamed' },
        }),
      ).rejects.toThrow()
    })

    it('rejects an attempt to change the tenant field', async () => {
      await expect(
        db.project.update({
          where: { id: 'p1' },
          data: { organizationId: 'org2' },
        }),
      ).rejects.toThrow(TenantScopeError)
    })

    it('allows setting the tenant field to its current value', async () => {
      const updated = await db.project.update({
        where: { id: 'p1' },
        data: { organizationId: 'org1', name: 'Renamed' },
      })
      expect(updated.name).toBe('Renamed')
    })
  })

  describe('updateMany / updateManyAndReturn', () => {
    it('scopes the where clause with AND', async () => {
      const result = await db.project.updateMany({
        where: {},
        data: { name: 'Renamed' },
      })
      expect(result.count).toBe(1)

      const other = await db.$withoutTenant().project.findUniqueOrThrow({
        where: { id: 'p2' },
      })
      expect(other.name).toBe('Project Two')
    })

    it('rejects an attempt to change the tenant field', async () => {
      await expect(
        db.project.updateMany({
          where: {},
          data: { organizationId: 'org2' },
        }),
      ).rejects.toThrow(TenantScopeError)
    })

    it('updateManyAndReturn only returns the current tenant’s rows', async () => {
      const rows = await db.project.updateManyAndReturn({
        where: {},
        data: { name: 'Renamed' },
      })
      expect(rows.map((r) => r.id)).toEqual(['p1'])
    })
  })

  describe('upsert', () => {
    it('injects the tenant field on create', async () => {
      const project = await db.project.upsert({
        where: { id: 'p3' },
        create: { id: 'p3', name: 'Project Three' },
        update: { name: 'Existing' },
      })
      expect(project.organizationId).toBe('org1')
    })

    it('rejects an attempt to change the tenant field on update', async () => {
      await expect(
        db.project.upsert({
          where: { id: 'p1' },
          create: { id: 'p1', name: 'Project One' },
          update: { organizationId: 'org2' },
        }),
      ).rejects.toThrow(TenantScopeError)
    })
  })

  describe('delete / deleteMany', () => {
    it('deletes a row scoped to the current tenant', async () => {
      await db.project.delete({ where: { id: 'p1' } })
      const remaining = await db.$withoutTenant().project.findMany()
      expect(remaining.map((p) => p.id)).toEqual(['p2'])
    })

    it('fails to delete a row in another organization', async () => {
      await expect(db.project.delete({ where: { id: 'p2' } })).rejects.toThrow()
    })

    it('deleteMany only deletes the current tenant’s rows', async () => {
      const result = await db.project.deleteMany()
      expect(result.count).toBe(1)
      const remaining = await db.$withoutTenant().project.findMany()
      expect(remaining.map((p) => p.id)).toEqual(['p2'])
    })
  })

  describe('nested connect', () => {
    it('connects to a row in the same organization', async () => {
      const task = await db.task.create({
        data: {
          id: 't1',
          title: 'Task One',
          project: { connect: { id: 'p1' } },
        },
      })
      expect(task.projectId).toBe('p1')
      expect(task.organizationId).toBe('org1')
    })

    it('fails to connect to a row in another organization', async () => {
      await expect(
        db.task.create({
          data: {
            id: 't1',
            title: 'Task One',
            project: { connect: { id: 'p2' } },
          },
        }),
      ).rejects.toThrow()
    })
  })

  describe('$transaction', () => {
    it('stays scoped inside an interactive transaction', async () => {
      const project = await db.$transaction(async (tx) => {
        return tx.project.create({ data: { id: 'p3', name: 'Project Three' } })
      })
      expect(project.organizationId).toBe('org1')
    })

    it('rejects a cross-tenant write inside a transaction', async () => {
      await expect(
        db.$transaction(async (tx) => {
          return tx.project.update({
            where: { id: 'p2' },
            data: { name: 'Renamed' },
          })
        }),
      ).rejects.toThrow()
    })
  })
})
