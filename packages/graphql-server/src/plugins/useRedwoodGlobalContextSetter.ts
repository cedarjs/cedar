import type { Plugin } from 'graphql-yoga'

import { setContext } from '@cedarjs/context'

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
        setContext(context)
      }
    },
  })
