import { expect, test } from 'tstyche'

import { createTenancyExtension } from '@cedarjs/tenancy'
import type { UnscopedClient } from '@cedarjs/tenancy'

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

// An app often has helpers that take "the ambient `db` or a scoped client".
// Those only work if the clients the extension hands back have `db`'s own
// model API: on a union of two different Prisma Client types, TypeScript
// can't call some model methods (`groupBy`) or type a `$transaction`
// callback's parameter.
const scopedDb = db.$forOrg('some-org-id')
const unscopedDb = db.$withoutTenant()

test('$forOrg returns a client of the same type as db', () => {
  expect(scopedDb).type.toBe<typeof db>()
  expect(scopedDb.$forOrg('other-org-id')).type.toBe<typeof db>()
  expect(scopedDb.$withoutTenant()).type.toBe<typeof unscopedDb>()
})

test('a helper can take either db or a $forOrg client', () => {
  // Since the two have the same type, the helper names just that one.
  const countProjects = (client: typeof db) => client.project.count()

  expect(countProjects).type.toBeCallableWith(db)
  expect(countProjects).type.toBeCallableWith(scopedDb)
})

test('$withoutTenant returns db’s model API, with raw SQL allowed', () => {
  expect(unscopedDb).type.toBe<UnscopedClient<typeof db, typeof prismaClient>>()
  expect(unscopedDb.project).type.toBe<typeof db.project>()
  expect(unscopedDb.$transaction).type.toBe<typeof db.$transaction>()
  expect(unscopedDb.$forOrg('some-org-id')).type.toBe<typeof db>()
  expect(unscopedDb.$withoutTenant()).type.toBe<typeof unscopedDb>()

  expect(unscopedDb.$queryRaw`SELECT 1`).type.not.toRaiseError()
  expect(unscopedDb.$executeRawUnsafe('SELECT 1')).type.not.toRaiseError()
  expect(db.$queryRaw`SELECT 1`).type.toRaiseError()
  expect(scopedDb.$executeRawUnsafe('SELECT 1')).type.toRaiseError()
})

test('a helper can take either db or a $withoutTenant client', () => {
  type EitherDb = typeof db | typeof unscopedDb

  // A parameter, so the calls below are made on the union itself, not on
  // whichever member a variable was initialized with
  const helper = (either: EitherDb) => {
    expect(either.project.groupBy({ by: ['name'] })).type.not.toRaiseError()
    expect(
      either.$transaction(async (tx) => tx.project.count()),
    ).type.not.toRaiseError()
    // On the union, $forOrg's result is the union too: still a client with
    // db's model API
    expect(
      either.$forOrg('some-org-id').project.groupBy({ by: ['name'] }),
    ).type.not.toRaiseError()
  }

  expect(helper).type.toBeCallableWith(db)
  expect(helper).type.toBeCallableWith(unscopedDb)
})

test('a transaction client has no $forOrg or $withoutTenant to call', () => {
  // A client they built from a transaction client would run its queries
  // outside the transaction
  void db.$transaction(async (tx) => {
    expect(tx.$forOrg('some-org-id')).type.toRaiseError("'this' context")
    expect(tx.$withoutTenant()).type.toRaiseError("'this' context")
  })
  void unscopedDb.$transaction(async (tx) => {
    expect(tx.$forOrg('some-org-id')).type.toRaiseError("'this' context")
    expect(tx.$withoutTenant()).type.toRaiseError("'this' context")
  })
})
