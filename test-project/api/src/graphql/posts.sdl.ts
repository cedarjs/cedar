export const schema = gql`
  type Post {
    id: ID!
    title: String!
    body: String!
    authorId: String!
    author: User!
    createdAt: DateTime!
  }

  type Query {
    posts: [Post!]! @skipAuth
    post(id: ID!): Post @skipAuth
  }

  input CreatePostInput {
    title: String!
    body: String!
    authorId: String!
  }

  input UpdatePostInput {
    title: String
    body: String
    authorId: String
  }

  type Mutation {
    createPost(input: CreatePostInput!): Post! @requireAuth
    updatePost(id: ID!, input: UpdatePostInput!): Post! @requireAuth
    deletePost(id: ID!): Post! @requireAuth
  }
`
