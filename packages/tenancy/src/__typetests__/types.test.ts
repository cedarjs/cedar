import { expect, test } from 'tstyche'

import { createTenancyExtension } from '@cedarjs/tenancy'

import type { PrismaClient } from '../__tests__/prisma-client/client.js'

// tstyche only type-checks this file; it never runs, so a type-only
// declaration is enough and avoids having to construct a real adapter.
declare const prismaClient: PrismaClient

const db = prismaClient.$extends(
  createTenancyExtension<typeof prismaClient>({
    models: { allExcept: ['user', 'organization', 'membership', 'tag'] },
  }),
)

test('the extension does not change a model method’s result type', () => {
  expect<ReturnType<typeof db.project.findMany>>().type.toBe<
    ReturnType<typeof prismaClient.project.findMany>
  >()
  expect<ReturnType<typeof db.organization.findMany>>().type.toBe<
    ReturnType<typeof prismaClient.organization.findMany>
  >()
})

test('$forOrg returns a client with the same model API', () => {
  const orgDb = db.$forOrg('some-org-id')

  expect(orgDb.project).type.toHaveProperty('findMany')
  expect(orgDb.project).type.toHaveProperty('create')
  expect<ReturnType<typeof orgDb.project.findMany>>().type.toBe<
    ReturnType<typeof prismaClient.project.findMany>
  >()
})

test('$withoutTenant returns a client with the same model API', () => {
  const unscopedDb = db.$withoutTenant()

  expect(unscopedDb.project).type.toHaveProperty('findMany')
  expect(unscopedDb.project).type.toHaveProperty('create')
  expect<ReturnType<typeof unscopedDb.project.findMany>>().type.toBe<
    ReturnType<typeof prismaClient.project.findMany>
  >()
})
