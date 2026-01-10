// Define your own mock data here:
export const standard = (/* vars, { ctx, req } */) => ({
  author: {
    __typename: 'User' as const,
    id: '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d',
    email: 'fortytwo@42.com',
    fullName: 'Forty Two',
  },
})
