import type { PluginOption } from 'vite'

export function mockRouter(): PluginOption {
  return {
    name: 'mock-@cedarjs/router',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (id.includes('src')) {
        code = code.replace(
          "'@cedarjs/router'",
          // TODO: Use the mock router from @cedarjs/testing instead
          "'storybook-framework-cedarjs/dist/mocks/MockRouter'",
        )
      }
      return code
    },
  }
}
