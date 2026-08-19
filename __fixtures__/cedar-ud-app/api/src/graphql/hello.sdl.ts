export const schema = gql`
  type Query {
    hello: String! @skipAuth
  }
`
