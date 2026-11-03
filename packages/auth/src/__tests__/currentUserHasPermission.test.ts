import { describe, expect, it } from 'vitest'

import { currentUserHasPermission } from '../currentUserHasPermission.js'

describe('currentUserHasPermission', () => {
  it('is false when nobody is logged in', () => {
    expect(currentUserHasPermission(null, 'posts.edit')).toBe(false)
  })

  it('is false when the user has no permissions', () => {
    expect(currentUserHasPermission({ id: 1 }, 'posts.edit')).toBe(false)
    expect(
      currentUserHasPermission({ permissions: 'posts.edit' }, 'posts.edit'),
    ).toBe(false)
  })

  it('checks currentUser.permissions', () => {
    const currentUser = { permissions: ['posts.read', 'posts.edit'] }

    expect(currentUserHasPermission(currentUser, 'posts.edit')).toBe(true)
    expect(currentUserHasPermission(currentUser, 'users.manage')).toBe(false)
  })
})
