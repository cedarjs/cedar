import type { Plugin } from 'graphql-yoga'

import { setContext } from '@cedarjs/context'
import { getAsyncStoreInstance } from '@cedarjs/context/dist/store'

import type { CedarGraphQLContext } from '../types.js'

/**
 * This Envelop plugin waits until the GraphQL context is done building and sets
 * the CedarJS global context which can be imported with:
 * `import { context } from '@cedarjs/context'`
 */
export const useRedwoodGlobalContextSetter =
  (): Plugin<CedarGraphQLContext> => ({
    onContextBuilding() {
      return ({ context }) => {
        // Wrap setContext() in an AsyncLocalStorage run so the directive
        // validators (which read context.currentUser) can find the store.
        // Without this, the auth handler's ALS run is in a different async
        // scope from the graphql request, and context.currentUser is
        // always undefined for @requireAuth.
        const store = getAsyncStoreInstance()
        const run = () => setContext(context)
        if (store.getStore()) {
          run()
        } else {
          store.run(new Map(), run)
        }
      }
    },
  })
