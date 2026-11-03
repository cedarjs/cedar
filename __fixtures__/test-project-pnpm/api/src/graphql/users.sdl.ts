export const schema = gql`
  type User {
    id: String!
    email: String!
    fullName: String!
    roles: String
    posts: [Post]!
  }

  type Query {
    user(id: String!): User @skipAuth
  }
`
