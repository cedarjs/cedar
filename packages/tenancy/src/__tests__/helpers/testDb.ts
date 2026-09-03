import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { createTenancyExtension } from '../../prismaExtension.js'
import { PrismaClient } from '../prisma-client/client.js'

const adapter = new PrismaBetterSqlite3({
  url: 'file:src/__tests__/for_unit_test.db',
})

const basePrisma = new PrismaClient({ adapter })

/**
 * A mutable box for the "current tenant id" the tests drive `db` with,
 * instead of `context.currentOrg`. `prismaExtension.context.test.ts` is the
 * one file that goes through the real `@cedarjs/context` store to prove the
 * default `getTenantId` also works.
 */
export const tenant = { id: undefined as string | undefined }

export const db = basePrisma.$extends(
  createTenancyExtension<typeof basePrisma>({
    models: { allExcept: ['user', 'organization', 'membership', 'tag'] },
    getTenantId: () => tenant.id,
  }),
)

export const rawDb = basePrisma

/**
 * Deletes every row across every model, in FK-safe order, and recreates the
 * two-organization fixture every test in this package builds on:
 * - `org1` / `org2`, each with one project (`p1` in `org1`, `p2` in `org2`)
 * - a user with an `owner` membership in `org1`
 * - a global `Tag` attached to `p1`
 */
export async function resetTestDb() {
  await basePrisma.task.deleteMany()
  await basePrisma.document.deleteMany()
  await basePrisma.projectSettings.deleteMany()
  await basePrisma.project.deleteMany()
  await basePrisma.tag.deleteMany()
  await basePrisma.membership.deleteMany()
  await basePrisma.organization.deleteMany()
  await basePrisma.user.deleteMany()

  await basePrisma.organization.create({
    data: { id: 'org1', name: 'Org One', slug: 'org-one' },
  })
  await basePrisma.organization.create({
    data: { id: 'org2', name: 'Org Two', slug: 'org-two' },
  })

  await basePrisma.user.create({
    data: { id: 'user1', email: 'user1@example.com' },
  })
  await basePrisma.membership.create({
    data: {
      id: 'membership1',
      userId: 'user1',
      organizationId: 'org1',
      role: 'owner',
    },
  })

  await basePrisma.project.create({
    data: { id: 'p1', organizationId: 'org1', name: 'Project One' },
  })
  await basePrisma.project.create({
    data: { id: 'p2', organizationId: 'org2', name: 'Project Two' },
  })

  await basePrisma.tag.create({
    data: {
      id: 'tag1',
      name: 'Tag One',
      projects: { connect: { id: 'p1' } },
    },
  })

  tenant.id = 'org1'
}
