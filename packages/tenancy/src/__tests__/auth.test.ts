import { describe, expect, it } from 'vitest'

import { context, setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { createTenancyAuth, hasOrgRole } from '../auth.js'

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

describe('hasOrgRole', () => {
  it('is false with no authenticated user', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      expect(hasOrgRole('viewer')).toBe(false)
      expect(hasOrgRole('viewer', 'org1')).toBe(false)
    })
  })

  it('is false with no current organization and no organizationId given', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser })
      expect(hasOrgRole('viewer')).toBe(false)
    })
  })

  it('checks the role on context.currentOrg when no organizationId is given', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser, currentOrg: currentOrg1Viewer })
      expect(hasOrgRole('viewer')).toBe(true)
      expect(hasOrgRole('owner')).toBe(false)
      expect(hasOrgRole(['owner', 'viewer'])).toBe(true)
    })
  })

  it('checks a specific organization via currentUser.memberships when organizationId is given', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser, currentOrg: currentOrg1Viewer })
      // Checking a role in org2, even though the request is currently
      // scoped to org1.
      expect(hasOrgRole('owner', 'org2')).toBe(true)
      expect(hasOrgRole('viewer', 'org2')).toBe(false)
    })
  })

  it('is false for an organization with no membership', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser, currentOrg: currentOrg1Viewer })
      expect(hasOrgRole('owner', 'org3')).toBe(false)
    })
  })

  it('an empty roles array is true as long as a membership exists', async () => {
    await getAsyncStoreInstance().run(new Map(), async () => {
      setContext({ currentUser, currentOrg: currentOrg1Viewer })
      expect(hasOrgRole([])).toBe(true)
      expect(hasOrgRole([], 'org2')).toBe(true)
      expect(hasOrgRole([], 'org3')).toBe(false)
    })
  })
})

const run = (fn: () => void | Promise<void>) =>
  getAsyncStoreInstance().run(new Map(), async () => fn())

describe('createTenancyAuth', () => {
  describe('hasUserRole', () => {
    const { hasUserRole } = createTenancyAuth()

    it("checks currentUser.roles, not the membership's", async () => {
      await run(() => {
        setContext({
          currentUser: { ...currentUser, roles: ['superuser'] },
          currentOrg: currentOrg1Viewer,
        })
        expect(hasUserRole('superuser')).toBe(true)
        expect(hasUserRole(['admin', 'superuser'])).toBe(true)
        // The role in the current organization doesn't count
        expect(hasUserRole('viewer')).toBe(false)
        expect(hasUserRole([])).toBe(false)
      })
    })

    it('is false with no current user', async () => {
      await run(() => {
        expect(hasUserRole('superuser')).toBe(false)
      })
    })
  })

  describe('requireUserAuth', () => {
    const { requireUserAuth } = createTenancyAuth()

    it('throws AuthenticationError with no current user', async () => {
      await run(() => {
        expect(() => requireUserAuth()).toThrow(AuthenticationError)
      })
    })

    it('needs a signed-in user only', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(() => requireUserAuth()).not.toThrow()
      })
    })

    it("checks currentUser.roles, not the membership's", async () => {
      await run(() => {
        setContext({
          currentUser: { ...currentUser, roles: ['superuser'] },
          currentOrg: currentOrg1Viewer,
        })
        expect(() => requireUserAuth({ roles: 'superuser' })).not.toThrow()
        expect(() => requireUserAuth({ roles: 'viewer' })).toThrow(
          ForbiddenError,
        )
      })
    })

    it('refuses everyone for an empty list, as requireAuth did', async () => {
      await run(() => {
        setContext({ currentUser: { ...currentUser, roles: ['superuser'] } })
        expect(() => requireUserAuth({ roles: [] })).toThrow(ForbiddenError)
      })
    })
  })

  describe('hasOrgRole', () => {
    const { hasOrgRole: orgRole } = createTenancyAuth()

    it('is any membership with no roles', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: currentOrg1Viewer })
        expect(orgRole()).toBe(true)
        expect(orgRole(undefined, 'org2')).toBe(true)
        expect(orgRole('owner')).toBe(false)
        expect(orgRole('owner', 'org2')).toBe(true)
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
