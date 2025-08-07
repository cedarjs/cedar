import type { Plugin } from 'vite'

import { getConfig } from '@cedarjs/project-config'

// TODO: Remove Apollo swapping when streaming is stable
/**
 * Temporary plugin, that swaps the ApolloProvider import with the Suspense
 * enabled one, until it becomes stable.
 *
 * import { RedwoodApolloProvider } from "@cedarjs/web/apollo" ->
 * import { RedwoodApolloProvider } from "@cedarjs/web/dist/apollo/suspense"
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
        return code.replace(
          '@cedarjs/web/apollo',
          '@cedarjs/web/dist/apollo/suspense',
        )
      }

      return code
    },
  }
}
