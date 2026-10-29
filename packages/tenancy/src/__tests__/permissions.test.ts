import { describe, expect, it } from 'vitest'

import { setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { createPermissions, definePermissions } from '../permissions.js'

const run = (fn: () => void | Promise<void>) =>
  getAsyncStoreInstance().run(new Map(), async () => fn())

const definitions = definePermissions({
  permissions: [
    'projects.read',
    'projects.edit',
    'members.manage',
    'reports.sign',
  ],
  roles: {
    owner: ['projects.read', 'projects.edit', 'members.manage'],
    member: ['projects.read'],
    fieldWorker: ['reports.sign'],
  },
})

const permissions = createPermissions(definitions)

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

describe('definePermissions', () => {
  it('throws for a role listing a permission that is not defined', () => {
    expect(() =>
      definePermissions({
        permissions: ['projects.read'],
        // @ts-expect-error - a typo is a type error too
        roles: { owner: ['projects.raed'] },
      }),
    ).toThrow('Unknown permission "projects.raed" in role "owner"')
  })
})

describe('createPermissions', () => {
  it('checks the definitions too', () => {
    expect(() =>
      createPermissions({
        permissions: ['projects.read'],
        roles: { owner: ['projects.raed' as 'projects.read'] },
      }),
    ).toThrow('Unknown permission "projects.raed" in role "owner"')
  })

  describe('hasPermission', () => {
    it("checks the role's permissions in the current organization", async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(permissions.hasPermission('projects.read')).toBe(true)
        // The user is owner of org2, not of this one
        expect(permissions.hasPermission('projects.edit')).toBe(false)
      })
    })

    it('is false outside an organization', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(permissions.hasPermission('projects.read')).toBe(false)
      })
    })

    it('is false with no current user', async () => {
      await run(() => {
        expect(permissions.hasPermission('projects.read')).toBe(false)
      })
    })

    it('is false for a role the definitions do not list', async () => {
      await run(() => {
        setContext({
          currentUser,
          currentOrg: { ...inOrg1, role: 'constructor' },
        })
        expect(permissions.hasPermission('projects.read')).toBe(false)
      })
    })

    it('throws for a permission that is not defined', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        // @ts-expect-error - a typo is a type error too
        expect(() => permissions.hasPermission('projects.raed')).toThrow(
          'Unknown permission "projects.raed"',
        )
      })
    })
  })

  describe('requirePermission', () => {
    it('throws AuthenticationError with no current user', async () => {
      await run(() => {
        expect(() => permissions.requirePermission('projects.read')).toThrow(
          AuthenticationError,
        )
      })
    })

    it('throws ForbiddenError without a current organization', async () => {
      await run(() => {
        setContext({ currentUser })
        expect(() => permissions.requirePermission('projects.read')).toThrow(
          'You must be a member of an organization to do that.',
        )
      })
    })

    it("throws ForbiddenError when the role doesn't have it", async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(() => permissions.requirePermission('projects.edit')).toThrow(
          ForbiddenError,
        )
      })
    })

    it('passes when the role has it', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(() =>
          permissions.requirePermission('projects.read'),
        ).not.toThrow()
      })
    })
  })

  describe('canGrantRole', () => {
    const inOrg2 = {
      id: 'org2',
      slug: 'org-two',
      role: 'owner',
      membershipId: 'membership2',
    }

    it('allows a role whose permissions the user all has', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg2 })
        expect(permissions.canGrantRole('owner')).toBe(true)
        expect(permissions.canGrantRole('member')).toBe(true)
      })
    })

    it('refuses a role with a permission the user lacks', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg1 })
        expect(permissions.canGrantRole('owner')).toBe(false)
        expect(permissions.canGrantRole('member')).toBe(true)

        setContext({ currentUser, currentOrg: inOrg2 })
        // The owner can't sign reports themselves, so can't hand that out
        expect(permissions.canGrantRole('fieldWorker')).toBe(false)
      })
    })

    it('refuses a role the definitions do not list', async () => {
      await run(() => {
        setContext({ currentUser, currentOrg: inOrg2 })
        expect(permissions.canGrantRole('constructor')).toBe(false)
        expect(permissions.canGrantRole('toString')).toBe(false)
      })
    })

    it('is false outside an organization, or with no current user', async () => {
      await run(() => {
        expect(permissions.canGrantRole('member')).toBe(false)

        setContext({ currentUser })
        expect(permissions.canGrantRole('member')).toBe(false)
      })
    })
  })

  describe('permissionsOf', () => {
    it("is the membership's role's permissions", () => {
      expect(permissions.permissionsOf({ role: 'member' })).toEqual([
        'projects.read',
      ])
      expect(permissions.permissionsOf({ role: 'constructor' })).toEqual([])
    })
  })

  describe('withPermissions', () => {
    it("adds each membership's permissions", () => {
      const user = permissions.withPermissions(currentUser)

      expect(user.memberships.map((m) => m.permissions)).toEqual([
        ['projects.read'],
        ['projects.read', 'projects.edit', 'members.manage'],
      ])
      expect(user.id).toBe('user1')
    })

    it('passes null through', () => {
      expect(permissions.withPermissions(null)).toBe(null)
    })
  })
})
