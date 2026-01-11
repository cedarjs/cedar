test('Set a mock user on the context', async () => {
  const user = {
    id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d',
    name: 'Bond, James Bond',
    email: 'totallyNotASpy@example.com',
    roles: 'secret_agent',
    fullName: 'Bond, James Bond',
    hashedPassword: 'hash',
    salt: 'salt',
    resetToken: null,
    resetTokenExpiresAt: null,
  }
  mockCurrentUser(user)
  expect(context.currentUser).toStrictEqual(user)
})

test('Context is isolated between tests', () => {
  expect(context).toStrictEqual({})
})
