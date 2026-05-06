import { pathToFileURL } from 'node:url'

import { buildCedarContext, requestToLegacyEvent } from '@cedarjs/api/runtime'
import { createGraphQLYoga } from '@cedarjs/graphql-server'

export interface GraphQLHandlerOptions {
  distPath: string
}

export function createGraphQLHandler(options: GraphQLHandlerOptions) {
  let yogaInitPromise: Promise<{ yoga: any; graphqlOptions: any }> | null = null

  async function getYoga() {
    if (!yogaInitPromise) {
      yogaInitPromise = (async () => {
        const mod = await import(pathToFileURL(options.distPath).href)
        const opts = mod.__rw_graphqlOptions
        const { yoga } = await createGraphQLYoga(opts)
        return { yoga, graphqlOptions: opts }
      })()
    }

    return yogaInitPromise
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const { yoga, graphqlOptions } = await getYoga()
      const cedarContext = await buildCedarContext(request, {
        authDecoder: graphqlOptions?.authDecoder,
      })
      const event = await requestToLegacyEvent(request, cedarContext)

      return yoga.handle(request, {
        request,
        cedarContext,
        event,
        requestContext: undefined,
      })
    },
  }
}
