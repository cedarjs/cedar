import gql from 'graphql-tag'

// This is a SPEC FILE that should be EXCLUDED from GraphQL schema generation
// If this file is loaded, it will add unwanted types to the schema

export const schema = gql`
  type SpecFileShouldNotBeInSchema {
    id: Int!
    thisIsFromASpecFile: String!
  }

  extend type Query {
    specFileShouldNotBeLoaded: SpecFileShouldNotBeInSchema
  }
`

// This would be test code in a real spec file
export default schema
