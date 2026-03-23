// Define your own mock data here:
export const standard = (/* vars, { ctx, req } */) => ({
  blogPost: {
    __typename: 'Post' as const,
    id: 42,
    title: 'Mocked title',
    body: 'Mocked body',
    createdAt: '2022-01-17T13:57:51.607Z',
    authorId: '005d3e8e-2b1a-4f5c-8c7d-000000000005',

    author: {
      __typename: 'User' as const,
      email: 'five@5.com',
      fullName: 'Five Lastname',
    },
  },
})
