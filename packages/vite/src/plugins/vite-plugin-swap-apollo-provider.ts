import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

// TODO: Remove Apollo swapping when streaming is stable
/**
 * Temporary plugin, that swaps the ApolloProvider import with the Suspense
 * enabled one, until it becomes stable.
 *
 * import { RedwoodApolloProvider } from "@cedarjs/web/apollo" ->
 * import { RedwoodApolloProvider } from "@cedarjs/web/dist/apollo/suspense"
 *
 * import { CedarApolloProvider } from "@cedarjs/web/apollo/CedarApolloProvider" ->
 * import { CedarApolloProvider } from "@cedarjs/web/dist/apollo/suspense"
 */
export function cedarSwapApolloProvider(): Plugin | undefined {
  const streamingEnabled = getConfig().experimental?.streamingSsr?.enabled

  if (!streamingEnabled) {
    return undefined
  }

  return {
    name: 'redwood-swap-apollo-provider',
    async transform(code: string, id: string) {
      if (/web\/src\/App\.(ts|tsx|js|jsx)$/.test(id)) {
        // Only swap the exact `@cedarjs/web/apollo` barrel specifier or the
        // `@cedarjs/web/apollo/CedarApolloProvider` subpath specifier. A
        // plain substring replace would corrupt the subpath into
        // `@cedarjs/web/dist/apollo/suspense/CedarApolloProvider`, which
        // doesn't exist.
        return code.replace(
          /@cedarjs\/web\/apollo(?:\/CedarApolloProvider)?/g,
          '@cedarjs/web/dist/apollo/suspense',
        )
      }

      return code
    },
  }
}
