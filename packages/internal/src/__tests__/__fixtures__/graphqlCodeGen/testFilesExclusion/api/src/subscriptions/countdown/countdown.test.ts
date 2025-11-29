import gql from 'graphql-tag'

// This is a TEST FILE that should be EXCLUDED from GraphQL schema generation
// If this file is loaded, it will add unwanted types to the schema

export const schema = gql`
  type SubscriptionTestFileShouldNotBeInSchema {
    id: Int!
    thisIsFromASubscriptionTestFile: String!
  }

  extend type Query {
    subscriptionTestFileShouldNotBeLoaded: SubscriptionTestFileShouldNotBeInSchema
  }
`

// This would be test code in a real test file
export default schema
