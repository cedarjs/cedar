import { beforeEach, describe, expect, it } from 'vitest'

import { setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'

import { TenantScopeError } from '../errors.js'
import { createTenancyExtension } from '../prismaExtension.js'

import { rawDb, resetTestDb } from './helpers/testDb.js'

// This is the one file that drives the extension's *default* `getTenantId`
// (reading `context.currentOrg?.id` from `@cedarjs/context`) through the
// real `AsyncLocalStorage` store, rather than an injected `getTenantId`
// function. Every other `prismaExtension.*.test.ts` file uses an injected
// `getTenantId` for speed and isolation.
const contextScopedDb = rawDb.$extends(
  createTenancyExtension<typeof rawDb>({
    models: { allExcept: ['user', 'organization', 'membership', 'tag'] },
  }),
)

describe('createTenancyExtension - default getTenantId via @cedarjs/context', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('reads the tenant id from context.currentOrg inside the async store', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({
        currentOrg: {
          id: 'org1',
          slug: 'org-one',
          role: 'owner',
          membershipId: 'membership1',
        },
      })

      const projects = await contextScopedDb.project.findMany()
      expect(projects.map((p) => p.id)).toEqual(['p1'])
    })
  })

  it('throws TenantScopeError when the store has no currentOrg', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      await expect(contextScopedDb.project.findMany()).rejects.toThrow(
        TenantScopeError,
      )
    })
  })

  it('throws TenantScopeError with no active store at all', async () => {
    await expect(contextScopedDb.project.findMany()).rejects.toThrow(
      TenantScopeError,
    )
  })
})
