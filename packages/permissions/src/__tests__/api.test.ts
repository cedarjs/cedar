import { describe, expect, it } from 'vitest'

import { setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store.js'
import { AuthenticationError, ForbiddenError } from '@cedarjs/graphql-server'

import { createPermissions } from '../api.js'
import { definePermissions } from '../index.js'

const run = (fn: () => void | Promise<void>) =>
  getAsyncStoreInstance().run(new Map(), async () => fn())

const definitions = definePermissions({
  permissions: ['posts.read', 'posts.edit', 'users.manage', 'reports.sign'],
  roles: {
    admin: ['posts.read', 'posts.edit', 'users.manage'],
    editor: ['posts.read', 'posts.edit'],
    reader: ['posts.read'],
    signer: ['reports.sign'],
  },
})

const permissions = createPermissions(definitions)

const reader = { id: 1, roles: 'reader' }
const editorAndSigner = { id: 2, roles: ['editor', 'signer'] }

describe('createPermissions', () => {
  it('checks the definitions too', () => {
    expect(() =>
      createPermissions({
        permissions: ['posts.read'],
        roles: { admin: ['posts.raed'] },
      }),
    ).toThrow('Unknown permission "posts.raed" in role "admin"')
  })

  describe('hasPermission', () => {
    it("checks the user's role", async () => {
      await run(() => {
        setContext({ currentUser: reader })
        expect(permissions.hasPermission('posts.read')).toBe(true)
        expect(permissions.hasPermission('posts.edit')).toBe(false)
      })
    })

    it('checks every role in a list', async () => {
      await run(() => {
        setContext({ currentUser: editorAndSigner })
        expect(permissions.hasPermission('posts.edit')).toBe(true)
        expect(permissions.hasPermission('reports.sign')).toBe(true)
        expect(permissions.hasPermission('users.manage')).toBe(false)
      })
    })

    it('is false with no current user, or no roles', async () => {
      await run(() => {
        expect(permissions.hasPermission('posts.read')).toBe(false)

        setContext({ currentUser: { id: 3 } })
        expect(permissions.hasPermission('posts.read')).toBe(false)
      })
    })

    it('goes by the roles, not a permissions field', async () => {
      await run(() => {
        setContext({ currentUser: { id: 3, permissions: ['posts.read'] } })
        expect(permissions.hasPermission('posts.read')).toBe(false)
      })
    })

    it('is false for a role the definitions do not list', async () => {
      await run(() => {
        setContext({ currentUser: { id: 3, roles: ['constructor'] } })
        expect(permissions.hasPermission('posts.read')).toBe(false)
      })
    })

    it('throws for a permission that is not defined', async () => {
      await run(() => {
        setContext({ currentUser: reader })
        // @ts-expect-error - a typo is a type error too
        expect(() => permissions.hasPermission('posts.raed')).toThrow(
          'Unknown permission "posts.raed"',
        )
      })
    })
  })

  describe('requirePermission', () => {
    it('throws AuthenticationError with no current user', async () => {
      await run(() => {
        expect(() => permissions.requirePermission('posts.read')).toThrow(
          AuthenticationError,
        )
      })
    })

    it("throws ForbiddenError when the user's roles don't have it", async () => {
      await run(() => {
        setContext({ currentUser: reader })
        expect(() => permissions.requirePermission('posts.edit')).toThrow(
          ForbiddenError,
        )
      })
    })

    it('passes when one of their roles has it', async () => {
      await run(() => {
        setContext({ currentUser: editorAndSigner })
        expect(() => permissions.requirePermission('posts.edit')).not.toThrow()
      })
    })
  })

  describe('canGrantRole', () => {
    it('allows a role whose permissions the user all has', async () => {
      await run(() => {
        setContext({ currentUser: { id: 4, roles: ['admin'] } })
        expect(permissions.canGrantRole('admin')).toBe(true)
        expect(permissions.canGrantRole('reader')).toBe(true)
      })
    })

    it('refuses a role with a permission the user lacks', async () => {
      await run(() => {
        setContext({ currentUser: { id: 4, roles: ['admin'] } })
        // An admin can't sign reports themselves, so can't hand that out
        expect(permissions.canGrantRole('signer')).toBe(false)

        setContext({ currentUser: reader })
        expect(permissions.canGrantRole('editor')).toBe(false)
      })
    })

    it('refuses a role the definitions do not list', async () => {
      await run(() => {
        setContext({ currentUser: { id: 4, roles: ['admin'] } })
        expect(permissions.canGrantRole('constructor')).toBe(false)
        expect(permissions.canGrantRole('toString')).toBe(false)
      })
    })

    it('is false with no current user', async () => {
      await run(() => {
        expect(permissions.canGrantRole('reader')).toBe(false)
      })
    })
  })

  describe('permissionsOf', () => {
    it("is the user's roles' permissions", () => {
      expect(permissions.permissionsOf(editorAndSigner)).toEqual([
        'posts.read',
        'posts.edit',
        'reports.sign',
      ])
      expect(permissions.permissionsOf({ roles: 42 })).toEqual([])
      expect(permissions.permissionsOf(null)).toEqual([])
    })
  })

  describe('withPermissions', () => {
    it("adds the user's permissions", () => {
      expect(permissions.withPermissions(reader)).toEqual({
        id: 1,
        roles: 'reader',
        permissions: ['posts.read'],
      })
    })

    it('gives a user without roles no permissions', () => {
      expect(permissions.withPermissions({ id: 3 }).permissions).toEqual([])
    })

    it('passes null through', () => {
      expect(permissions.withPermissions(null)).toBe(null)
    })
  })
})
