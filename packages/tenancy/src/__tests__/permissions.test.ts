import { describe, expect, it } from 'vitest'

import { setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { createPermissions } from '../permissions.js'

const run = (fn: () => void | Promise<void>) =>
  getAsyncStoreInstance().run(new Map(), async () => fn())

const permissions = createPermissions({
  roles: {
    owner: ['projects.read', 'projects.edit', 'members.manage'],
    member: ['projects.read'],
    fieldWorker: ['reports.sign'],
  },
  user: ['account.manage'],
})

const currentUser = {
  id: 'user1',
  memberships: [
    { id: 'membership1', organizationId: 'org1', role: 'member' },
    { id: 'membership2', organizationId: 'org2', role: 'owner' },
  ],
}

const inOrg1 = {
  id: 'org1',
  slug: 'org-one',
  role: 'member',
  membershipId: 'membership1',
}

describe('createPermissions', () => {
  describe('can', () => {
    it("checks the role's permissions in the current organization", async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(permissions.can('projects.read')).toBe(true)
        // The user is owner of org2, not of this one
        expect(permissions.can('projects.edit')).toBe(false)
      })
    })

    it('is false for an organization permission outside an organization', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(permissions.can('projects.read')).toBe(false)
      })
    })

    it('gives user permissions to every signed-in user', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(permissions.can('account.manage')).toBe(true)
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(permissions.can('account.manage')).toBe(true)
      })
    })

    it('is false with no current user', async () => {
      await run(() => {
        expect(permissions.can('account.manage')).toBe(false)
      })
    })

    it('is false for a role the map does not list', async () => {
      await run(() => {
        setContext({
          currentUser,
          currentOrg: { ...inOrg1, role: 'constructor' },
        })
        expect(permissions.can('projects.read')).toBe(false)
      })
    })

    it('throws for a permission the map does not know', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        // @ts-expect-error - a typo is a type error too
        expect(() => permissions.can('projects.raed')).toThrow(
          'Unknown permission "projects.raed"',
        )
      })
    })
  })

  describe('requirePermission', () => {
    it('throws AuthenticationError with no current user', async () => {
      await run(() => {
        expect(() =>
          permissions.requirePermission({ permission: 'account.manage' }),
        ).toThrow(AuthenticationError)
      })
    })

    it('throws ForbiddenError for an organization permission without one', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(() =>
          permissions.requirePermission({ permission: 'projects.read' }),
        ).toThrow('You must be a member of an organization to do that.')
      })
    })

    it("throws ForbiddenError when the role doesn't have it", async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(() =>
          permissions.requirePermission({ permission: 'projects.edit' }),
        ).toThrow(ForbiddenError)
      })
    })

    it('passes when the role has it, or it is a user permission', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(() =>
          permissions.requirePermission({ permission: 'projects.read' }),
        ).not.toThrow()
        setContext({ currentUser, currentOrg: undefined })
        expect(() =>
          permissions.requirePermission({ permission: 'account.manage' }),
        ).not.toThrow()
      })
    })
  })

  describe('withPermissions', () => {
    it("adds each membership's permissions, with the user's", () => {
      const user = permissions.withPermissions(currentUser)

      expect(user.memberships.map((m) => m.permissions)).toEqual([
        ['projects.read', 'account.manage'],
        ['projects.read', 'projects.edit', 'members.manage', 'account.manage'],
      ])
      expect(user.id).toBe('user1')
    })

    it('passes null through', () => {
      expect(permissions.withPermissions(null)).toBe(null)
    })
  })
})
