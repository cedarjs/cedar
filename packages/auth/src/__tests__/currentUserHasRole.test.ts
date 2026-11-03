import { describe, expect, it } from 'vitest'

import { currentUserHasRole } from '../currentUserHasRole.js'

describe('currentUserHasRole', () => {
  it('is false when nobody is logged in', () => {
    expect(currentUserHasRole(null, 'admin')).toBe(false)
  })

  it('is false when the user has no roles', () => {
    expect(currentUserHasRole({ id: 1 }, 'admin')).toBe(false)
  })

  it('checks a string role against a string', () => {
    expect(currentUserHasRole({ roles: 'admin' }, 'admin')).toBe(true)
    expect(currentUserHasRole({ roles: 'admin' }, 'editor')).toBe(false)
  })

  it('checks a string role against an array', () => {
    expect(currentUserHasRole({ roles: ['admin'] }, 'admin')).toBe(true)
    expect(currentUserHasRole({ roles: ['admin'] }, 'editor')).toBe(false)
  })

  it('checks an array of roles against an array', () => {
    const user = { roles: ['author', 'editor'] }

    expect(currentUserHasRole(user, ['editor', 'publisher'])).toBe(true)
    expect(currentUserHasRole(user, ['admin', 'publisher'])).toBe(false)
  })

  it('checks an array of roles against a string', () => {
    expect(currentUserHasRole({ roles: 'editor' }, ['admin', 'editor'])).toBe(
      true,
    )
    expect(currentUserHasRole({ roles: 'editor' }, ['admin'])).toBe(false)
  })
})
