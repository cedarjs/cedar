export const schema = gql`
  type Post {
    id: Int!
    title: String!
  }

  type Query {
    posts: [Post!]! @requireAuth
  }

  type Mutation {
    deletePost(id: Int!): Boolean @requireAuth
    archivePost(id: Int!): Boolean @skipAuth
  }
`
