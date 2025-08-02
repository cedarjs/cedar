// Index file for functions directory
// This enables named imports like: import { graphqlHandler } from 'src/functions'

export { default as graphqlHandler } from './graphql.js'

// Re-export all named exports from individual function files
export * from './graphql.js'
