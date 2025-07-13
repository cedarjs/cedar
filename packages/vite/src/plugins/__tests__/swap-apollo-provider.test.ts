import { describe, it, expect, vi } from 'vitest'

import { cedarSwapApolloProvider } from '../vite-plugin-swap-apollo-provider.js'

vi.mock('@cedarjs/project-config', () => ({
  getConfig: vi.fn().mockReturnValue({
    experimental: {
      streamingSsr: {
        enabled: true,
      },
    },
  }),
}))

describe('excludeModule', () => {
  it('should swap the import', async () => {
    const plugin = cedarSwapApolloProvider()
    const pluginTransform = plugin?.transform

    if (typeof pluginTransform !== 'function') {
      throw new Error('Unexpeced transform type')
    }

    const output = await pluginTransform.call(
      // The plugin is not using anything on the context, so this is safe
      {} as ThisParameterType<typeof pluginTransform>,
      `import ApolloProvider from '@cedarjs/web/apollo'`,
      '/Users/dac09/Experiments/ssr-2354/web/src/App.tsx',
    )

    expect(output).toEqual(
      "import ApolloProvider from '@cedarjs/web/dist/apollo/suspense'",
    )
  })
})
