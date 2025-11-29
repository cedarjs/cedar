import gql from 'graphql-tag'

export const schema = gql`
  type Todo {
    id: Int!
    title: String!
    completed: Boolean!
  }

  type Query {
    todos: [Todo!]! @skipAuth
    todo(id: Int!): Todo @skipAuth
  }

  type Mutation {
    createTodo(title: String!): Todo! @requireAuth
    updateTodo(id: Int!, completed: Boolean!): Todo! @requireAuth
    deleteTodo(id: Int!): Todo! @requireAuth
  }
`
