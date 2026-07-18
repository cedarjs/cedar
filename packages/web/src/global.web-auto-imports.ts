import type _React from 'react'

import type { DocumentNode } from 'graphql'

// These are the global types exposed to a user's project
// For "internal" global types see ambient.d.ts

declare global {
  // This type is used for both regular RW projects and projects that have
  // enabled Trusted Documents. For regular RW projects, this could have been
  // typed just by importing gql from `graphql-tag`. But for Trusted Documents
  // the type should be imported from `web/src/graphql/gql.js` in the user's
  // project. The type here is generic enough to cover both cases.
  const gql: (
    source: string | TemplateStringsArray | readonly string[],
    ...args: any[]
  ) => DocumentNode

  // Having this as a type instead of a const allows us to augment/override it
  // in other packages
  type React = typeof _React

  interface Window {
    /** URL or absolute path to the GraphQL serverless function */
    RWJS_API_GRAPHQL_URL: string
    /** URL or absolute path to serverless functions */
    RWJS_API_URL: string
    __REDWOOD__APP_TITLE: string
  }
}
