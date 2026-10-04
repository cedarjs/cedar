import { mockRedwoodDirective, getDirectiveName } from '@cedarjs/testing/api'

import requireAuth from './requireAuth.js'

describe('requireAuth directive', () => {
  it('declares the directive sdl as schema, with the correct name', () => {
    expect(requireAuth.schema).toBeTruthy()
    expect(getDirectiveName(requireAuth.schema)).toBe('requireAuth')
  })

  it('throws when there is no current user', () => {
    const mockExecution = mockRedwoodDirective(requireAuth, { context: {} })

    expect(mockExecution).toThrowError("You don't have permission to do that.")
  })

  it('does not throw when there is a current user', () => {
    // The mocked user should have the same shape as what getCurrentUser()
    // in api/src/lib/auth returns
    const mockExecution = mockRedwoodDirective(requireAuth, {
      context: {
        currentUser: {
          id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d',
          roles: 'ADMIN',
          email: 'b@zinga.com',
        },
      },
    })

    expect(mockExecution).not.toThrowError()
  })
})
