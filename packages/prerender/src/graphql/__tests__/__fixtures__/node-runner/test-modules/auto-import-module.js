// Test module for autoImportsPlugin functionality
// This module uses gql and context which should be auto-imported

export const query = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`

export const mutation = gql`
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      id
      name
      email
    }
  }
`

export const blogPostQuery = gql`
  query FindBlogPostQuery($id: Int!) {
    blogPost: post(id: $id) {
      id
      title
      body
      author {
        email
        fullName
      }
      createdAt
    }
  }
`

export const testAutoImports = async () => {
  return {
    hasGql: typeof gql === 'function',
    hasContext: typeof context === 'object' && !!context,
    context,
  }
}

export const gqlQuery = query
export const gqlMutation = mutation

export default {
  testAutoImports,
  gqlQuery,
  gqlMutation
}
