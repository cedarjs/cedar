// Test module for autoImportsPlugin functionality
// This module uses gql and context which should be auto-imported

const query = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`

const mutation = gql`
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      id
      name
      email
    }
  }
`

export const testAutoImports = async () => {
  // Test that gql is available without explicit import
  const queryResult = {
    query,
    variables: { id: '123' }
  }

  return {
    hasGql: typeof gql === 'function',
    hasContext: typeof context === 'object' && !!context,
    queryDefined: !!query,
    mutationDefined: !!mutation,
    context,
    queryResult
  }
}

export const gqlQuery = query
export const gqlMutation = mutation

export default {
  testAutoImports,
  gqlQuery,
  gqlMutation
}
