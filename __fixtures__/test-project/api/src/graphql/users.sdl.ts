export const schema = gql`
  type User {
    id: String!
    email: String!
    hashedPassword: String!
    fullName: String!
    salt: String!
    resetToken: String
    resetTokenExpiresAt: DateTime
    roles: String
    posts: [Post]!
  }

  type Query {
    users: [User!]! @requireAuth
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
