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

  input CreateUserInput {
    email: String!
    fullName: String!
    roles: String
  }

  input UpdateUserInput {
    email: String
    fullName: String
    roles: String
  }
`
