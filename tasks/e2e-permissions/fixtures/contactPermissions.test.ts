import { hasPermission, requirePermission } from 'src/lib/permissions'

describe('permissions from the map', () => {
  it("gives a mocked user their role's permissions", () => {
    mockCurrentUser({ roles: 'ADMIN' })

    expect(hasPermission('contacts.delete')).toBe(true)
    expect(context.currentUser?.permissions).toEqual(['contacts.delete'])
  })

  it('refuses a user whose roles lack it', () => {
    mockCurrentUser({ roles: 'EDITOR' })

    expect(() => requirePermission('contacts.delete')).toThrow(
      "You don't have access to do that.",
    )
  })
})
