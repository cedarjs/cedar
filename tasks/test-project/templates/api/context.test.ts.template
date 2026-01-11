test('Set a mock user on the context', async () => {
  const user = {
    id: '00700000-0070-4007-A007-007000000000',
    name: 'Bond, James Bond',
    email: 'totallyNotASpy@example.com',
    roles: 'secret_agent',
  }
  mockCurrentUser(user)
  expect(context.currentUser).toStrictEqual(user)
})

test('Context is isolated between tests', () => {
  expect(context).toStrictEqual({})
})
