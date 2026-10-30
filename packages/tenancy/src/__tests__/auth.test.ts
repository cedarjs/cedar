import { describe, expect, it } from 'vitest'

import { context, setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { createTenancyAuth } from '../auth.js'

const currentUser = {
  id: 'user1',
  memberships: [
    { id: 'membership1', organizationId: 'org1', role: 'viewer' },
    { id: 'membership2', organizationId: 'org2', role: 'owner' },
  ],
}

const currentOrg1Viewer = {
  id: 'org1',
  slug: 'org-one',
  role: 'viewer',
  membershipId: 'membership1',
}

const run = (fn: () => void | Promise<void>) =>
  getAsyncStoreInstance().run(new Map(), async () => fn())

describe('createTenancyAuth', () => {
  describe('hasRole', () => {
    const { hasRole } = createTenancyAuth()

    it("checks currentUser.roles, not the membership's", async () => {
      await run(() => {
        setContext({
          currentUser: { ...currentUser, roles: ['superuser'] },
          currentOrg: currentOrg1Viewer,
        })
        expect(hasRole('superuser')).toBe(true)
        expect(hasRole(['admin', 'superuser'])).toBe(true)
        // The role in the current organization doesn't count
        expect(hasRole('viewer')).toBe(false)
        expect(hasRole([])).toBe(false)
      })
    })

    it('is false with no current user', async () => {
      await run(() => {
        expect(hasRole('superuser')).toBe(false)
      })
    })
  })

  describe('requireAuth', () => {
    const { requireAuth } = createTenancyAuth()

    it('throws AuthenticationError with no current user', async () => {
      await run(() => {
        expect(() => requireAuth()).toThrow(AuthenticationError)
      })
    })

    it('needs a signed-in user only', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(() => requireAuth()).not.toThrow()
      })
    })

    it("checks currentUser.roles, not the membership's", async () => {
      await run(() => {
        setContext({
          currentUser: { ...currentUser, roles: ['superuser'] },
          currentOrg: currentOrg1Viewer,
        })
        expect(() => requireAuth({ roles: 'superuser' })).not.toThrow()
        expect(() => requireAuth({ roles: 'viewer' })).toThrow(ForbiddenError)
      })
    })

    it('refuses everyone for an empty list, as requireAuth did', async () => {
      await run(() => {
        setContext({ currentUser: { ...currentUser, roles: ['superuser'] } })
        expect(() => requireAuth({ roles: [] })).toThrow(ForbiddenError)
      })
    })
  })
})

// A quick sanity check that `context` really is fresh per test: this file
// relies on every test running inside its own `getAsyncStoreInstance().run`,
// so state from one test can't leak into the next.
describe('context isolation', () => {
  it('starts empty in a fresh store', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      expect(context.currentUser).toBeUndefined()
      expect(context.currentOrg).toBeUndefined()
    })
  })
})
