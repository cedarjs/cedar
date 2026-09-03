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

describe('what the scope error says', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('points a job or script at the escape hatches', async () => {
    // No async store at all: this is a job, a script or a seed.
    await expect(contextScopedDb.project.findMany()).rejects.toThrow(
      /running outside a request/,
    )
    await expect(contextScopedDb.project.findMany()).rejects.toThrow(
      /\$withoutTenant/,
    )
  })

  it('tells an anonymous request to name the organization', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({})

      await expect(contextScopedDb.project.findMany()).rejects.toThrow(
        /nobody signed in/,
      )
    })
  })

  it('tells a signed-in request what is missing', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser: { id: 'u1', memberships: [] } })

      const error = await contextScopedDb.project
        .findMany()
        .catch((e: unknown) => e)

      expect(String(error)).toMatch(/signed-in user has no organization/)
      expect(String(error)).toMatch(/cedar-org/)
      expect(String(error)).toMatch(/no membership yet/)
    })
  })
})

describe('createTenancyExtension - model name validation', () => {
  // The extension validates model names when it is applied (`$extends`), not
  // when `createTenancyExtension` is called, because it needs the client's
  // runtime data model to know which names are valid.
  it('throws TenantScopeError for an unknown model in allExcept', () => {
    expect(() =>
      rawDb.$extends(
        createTenancyExtension<typeof rawDb>({
          models: {
            allExcept: ['user', 'organization', 'membership', 'typo'],
          },
        }),
      ),
    ).toThrow(TenantScopeError)
  })

  it('lists the unknown model and valid options in the message', () => {
    expect(() =>
      rawDb.$extends(
        createTenancyExtension<typeof rawDb>({
          models: {
            allExcept: ['user', 'organization', 'membership', 'typo'],
          },
        }),
      ),
    ).toThrow(/typo/)
  })

  it('throws TenantScopeError for an unknown model in an explicit models list', () => {
    expect(() =>
      rawDb.$extends(
        createTenancyExtension<typeof rawDb>({
          models: ['project', 'typo'],
        }),
      ),
    ).toThrow(TenantScopeError)
  })

  it('accepts only valid model names', () => {
    expect(() =>
      rawDb.$extends(
        createTenancyExtension<typeof rawDb>({
          models: { allExcept: ['user', 'organization', 'membership', 'tag'] },
        }),
      ),
    ).not.toThrow()
  })
})
